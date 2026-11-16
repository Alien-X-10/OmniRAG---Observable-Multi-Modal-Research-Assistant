// File: src/generation/generator.js
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { retrieveAndCompact } from '../retrieval/compactor.js';
import { RAG_RESPONSE_SCHEMA, validateLLMOutput } from '../contracts/schema.js';
import { closeDB } from '../config/db.js';

dotenv.config({ quiet: true });

// Use v1beta so strict JSON schema streaming (responseSchema) is enabled
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  apiVersion: 'v1beta',
  httpOptions: { apiVersion: 'v1beta' },
});

// const GENERATION_MODEL = 'gemini-2.5-flash';
// const GENERATION_MODEL = 'gemini-3.1-flash-lite';
const GENERATION_MODEL = process.env.GENERATION_MODEL || 'gemini-3.1-flash-lite';

// Gemini 2.5 Flash reference pricing per 1M tokens (for observability cost tracking)
const COST_PER_1M_INPUT_USD = 0.15;
const COST_PER_1M_OUTPUT_USD = 0.60;

const SYSTEM_INSTRUCTION = `You are a zero-hallucination FAANG technical research assistant.
You must answer the user's question using ONLY the provided <chunk> blocks.

STRICT GROUNDING & CITATION RULES:
1. Every factual claim in your "answer" MUST include an inline citation tag formatted strictly as <chunk id="CHUNK_ID"> (e.g., <chunk id="vid_72x_14:32">).
2. Every chunk you cite in "answer" MUST also be included in the "citations" array with its exact chunk_id, video_id, and timestamp taken from the <chunk> attributes.
3. Do NOT extrapolate, guess, or use outside knowledge.
3. CRITICAL RULE: You MUST include the exact citation tag (e.g., <chunk id="vid_...">) at the end of any sentence that uses information from the context. If a chunk is in your citations array, its exact tag MUST appear in your answer text.
5. ABSTENTION PATH: If the provided <chunk> blocks are empty or do not explicitly contain the factual answer to the user's question, you MUST set "is_abstained": true, "answer": null, and "citations": [].`;

/**
 * Calculates estimated inference cost in USD from token counts.
 */
function calculateCostUsd(promptTokens, candidateTokens) {
  const inputCost = (promptTokens / 1_000_000) * COST_PER_1M_INPUT_USD;
  const outputCost = (candidateTokens / 1_000_000) * COST_PER_1M_OUTPUT_USD;
  return Number((inputCost + outputCost).toFixed(8));
}

/**
 * End-to-End Grounded RAG Generator with Streaming & TTFT Telemetry
 *
 * @param {string} query - The user's technical question
 * @param {object} options
 * @param {number} [options.topK=5] - Number of RRF candidates to retrieve
 * @param {function} [options.onStreamDelta] - Optional callback invoked on each streamed JSON chunk (used for SSE)
 */
export async function generateGroundedAnswer(
  query,
  { topK = 5, onStreamDelta = null } = {}
) {
  const pipelineStartMs = performance.now();

  // 1. Hybrid Retrieval + Cross-Encoder Filtering + Context Compaction
  const retrievalResult = await retrieveAndCompact(query, topK);
  const retrievalLatencyMs = Math.round(performance.now() - pipelineStartMs);

  // 2. Deterministic Abstention Short-Circuit:
  // If 0 chunks survived the Cross-Encoder threshold (0.5), immediately abstain
  // with zero generation hallucination risk and zero LLM output token cost.
  if (retrievalResult.survivingChunks.length === 0) {
    const abstainedPayload = {
      is_abstained: true,
      answer: null,
      citations: [],
    };

    validateLLMOutput(abstainedPayload);

    const serialized = JSON.stringify(abstainedPayload);
    if (onStreamDelta) {
      onStreamDelta(serialized);
    }

    return {
      query,
      output: abstainedPayload,
      telemetry: {
        model: GENERATION_MODEL,
        abstainedByGate: true,
        retrievalLatencyMs,
        ttftMs: 0,
        generationLatencyMs: 0,
        totalLatencyMs: retrievalLatencyMs,
        promptTokens: 0,
        candidateTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
        compactionMetrics: retrievalResult.telemetry,
      },
    };
  }

  // 3. Stream Grounded JSON Response from Gemini 2.5 Flash
  const genStartMs = performance.now();
  let ttftMs = null;
  let accumulatedJsonText = '';
  let usageMetadata = null;

  const prompt = `User Question: "${query}"

Context Chunks:
${retrievalResult.formattedContext}

Generate the strictly grounded JSON response following the required schema.`;

  const responseStream = await ai.models.generateContentStream({
    model: GENERATION_MODEL,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      temperature: 0.0,
      responseMimeType: 'application/json',
      responseSchema: RAG_RESPONSE_SCHEMA,
    },
  });

  for await (const chunk of responseStream) {
    if (ttftMs === null) {
      ttftMs = Math.round(performance.now() - genStartMs);
    }

    const deltaText = chunk.text || '';
    if (deltaText) {
      accumulatedJsonText += deltaText;
      if (onStreamDelta) {
        onStreamDelta(deltaText);
      }
    }

    if (chunk.usageMetadata) {
      usageMetadata = chunk.usageMetadata;
    }
  }

  const generationLatencyMs = Math.round(performance.now() - genStartMs);
  const totalLatencyMs = Math.round(performance.now() - pipelineStartMs);

  // 4. Parse & Enforce Runtime Contract Validation (schema.js)
  const parsedOutput = JSON.parse(accumulatedJsonText);
  validateLLMOutput(parsedOutput);

  const promptTokens = usageMetadata?.promptTokenCount || 0;
  const candidateTokens = usageMetadata?.candidatesTokenCount || 0;
  const totalTokens = usageMetadata?.totalTokenCount || promptTokens + candidateTokens;

  return {
    query,
    output: parsedOutput,
    telemetry: {
      model: GENERATION_MODEL,
      abstainedByGate: false,
      retrievalLatencyMs,
      ttftMs: ttftMs ?? generationLatencyMs,
      generationLatencyMs,
      totalLatencyMs,
      promptTokens,
      candidateTokens,
      totalTokens,
      estimatedCostUsd: calculateCostUsd(promptTokens, candidateTokens),
      compactionMetrics: retrievalResult.telemetry,
    },
  };
}

// CLI Test Runner: Tests both Grounded Generation (eval_001) and Abstention Path (eval_002)
if (process.argv[1] && process.argv[1].endsWith('generator.js')) {
  (async () => {
    const testQueries = [
      'How does adding jitter prevent the thundering herd problem during service retries?',
      'What database engine did the speaker recommend for storing biometric fingerprint data?',
    ];

    for (const q of testQueries) {
      console.log(`\n============================================================`);
      console.log(`[Generator Test] Query: "${q}"`);

      const result = await generateGroundedAnswer(q, {
        topK: 5,
        onStreamDelta: (delta) => process.stdout.write(delta),
      });

      console.log('\n\n[Contract Validation]: PASSED (validateLLMOutput)');
      console.log('[Parsed Output]:', JSON.stringify(result.output, null, 2));
      console.log('[Telemetry]:', JSON.stringify(result.telemetry, null, 2));
    }
  })()
    .catch((err) => {
      console.error('\n[Generator Error]:', err.message);
      process.exitCode = 1;
    })
    .finally(() => closeDB());
}