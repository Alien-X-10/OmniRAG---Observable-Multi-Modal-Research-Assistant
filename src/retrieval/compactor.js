// File: src/retrieval/compactor.js
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';
import { hybridRetrieve } from './hybridSearch.js';
import { closeDB } from '../config/db.js';
import { runWithModelFallback } from '../services/geminiRetry.js';

dotenv.config({ quiet: true });

// Explicitly use v1beta so JSON Mode (responseMimeType & responseSchema) is enabled
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  apiVersion: 'v1beta',
  httpOptions: { apiVersion: 'v1beta' },
});

const RERANK_MODELS = [
  ...new Set([
    process.env.GENERATION_MODEL || 'gemini-3.5-flash-lite',
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
    'gemini-2.5-flash',
  ]),
];
const RELEVANCE_THRESHOLD = 0.5;

// Common spoken-lecture filler phrases & transitions safe to strip without losing technical facts
const SPOKEN_FILLER_PATTERNS = [
  /\b(um|uh|erm|ah|hmm)\b,?\s*/gi,
  /\b(you know|i mean|sort of|kind of|basically|essentially|literally|actually)\b,?\s*/gi,
  /\b(so,?\s+as\s+you\s+can\s+see,?|now,?\s+let's\s+talk\s+about|moving\s+on\s+to)\b\s*/gi,
  /\b(in\s+order\s+to)\b/gi,
];

/**
 * Rough token estimator (~4 chars per token)
 */
function estimateTokens(text) {
  return Math.ceil(text.trim().length / 4);
}

/**
 * 1. Dynamic Context Compactor
 * Strips conversational filler words and redundant clauses from YouTube lecture transcripts
 * while preserving technical nouns, numbers, and algorithmic terms.
 */
export function compactChunkText(rawText) {
  let compacted = rawText;

  compacted = compacted.replace(/\bin order to\b/gi, 'to');
  compacted = compacted.replace(/\bdue to the fact that\b/gi, 'because');
  compacted = compacted.replace(/\bat the exact same\b/gi, 'at the same');
  compacted = compacted.replace(/\badditionally,?\s*/gi, '');

  for (const pattern of SPOKEN_FILLER_PATTERNS) {
    compacted = compacted.replace(pattern, '');
  }

  compacted = compacted.replace(/\s+/g, ' ').trim();

  const originalTokens = estimateTokens(rawText);
  const compactedTokens = estimateTokens(compacted);

  return {
    compactedText: compacted,
    originalTokens,
    compactedTokens,
    tokensSaved: Math.max(0, originalTokens - compactedTokens),
  };
}

/**
 * 2. Cross-Encoder Re-Ranker (with Automatic 503 Model Fallback)
 * Evaluates exact semantic alignment between the user query and all RRF candidate chunks
 * in a single batched pass, returning relevance scores on a [0.0, 1.0] scale.
 */
export async function crossEncodeRerank(query, candidateChunks) {
  if (!candidateChunks || candidateChunks.length === 0) {
    return [];
  }

  const promptPayload = candidateChunks.map((c) => ({
    chunk_id: c.chunk_id,
    content: c.content,
  }));

  const response = await runWithModelFallback({
    label: 'Cross-Encoder',
    models: RERANK_MODELS,
    attemptFn: (modelName) =>
      ai.models.generateContent({
        model: modelName,
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `You are a strict Cross-Encoder relevance judge for a technical RAG pipeline.
Score each candidate chunk from 0.0 to 1.0 based ONLY on whether the chunk explicitly contains facts that help answer the user query.
- Score 0.8 to 1.0: Directly answers the query with specific technical facts.
- Score 0.5 to 0.79: Partially answers or provides necessary technical context.
- Score 0.0 to 0.49: Does not answer the query or is merely topically related without answering the question.

User Query: "${query}"

Candidate Chunks:
${JSON.stringify(promptPayload, null, 2)}`,
              },
            ],
          },
        ],
        config: {
          temperature: 0.0,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              scores: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    chunk_id: { type: Type.STRING },
                    relevance_score: { type: Type.NUMBER },
                  },
                  required: ['chunk_id', 'relevance_score'],
                },
              },
            },
            required: ['scores'],
          },
        },
      }),
  });

  const parsed = JSON.parse(response.text);
  const scoreMap = new Map(
    (parsed.scores || []).map((s) => [s.chunk_id, Number(s.relevance_score)])
  );

  return candidateChunks
    .map((chunk) => ({
      ...chunk,
      cross_encoder_score: scoreMap.get(chunk.chunk_id) ?? 0.0,
    }))
    .filter((chunk) => chunk.cross_encoder_score >= RELEVANCE_THRESHOLD)
    .sort((a, b) => b.cross_encoder_score - a.cross_encoder_score);
}

/**
 * 3. Full Retrieval + Re-Ranking + Context Compaction Pipeline (User-Scoped)
 */
export async function retrieveAndCompact(query, topK = 5, userId = null) {
  const rrfCandidates = await hybridRetrieve(query, topK, userId);
  const relevantChunks = await crossEncodeRerank(query, rrfCandidates);

  let totalOriginalTokens = 0;
  let totalCompactedTokens = 0;

  const compactedChunks = relevantChunks.map((chunk) => {
    const { compactedText, originalTokens, compactedTokens, tokensSaved } =
      compactChunkText(chunk.content);

    totalOriginalTokens += originalTokens;
    totalCompactedTokens += compactedTokens;

    return {
      ...chunk,
      compacted_content: compactedText,
      token_metrics: {
        original: originalTokens,
        compacted: compactedTokens,
        saved: tokensSaved,
      },
    };
  });

  const formattedContext = compactedChunks
    .map(
      (c) =>
        `<chunk id="${c.chunk_id}" video_id="${c.video_metadata.video_id}" timestamp="${c.time_bounds.display_timestamp}">\n${c.compacted_content}\n</chunk>`
    )
    .join('\n\n');

  return {
    query,
    survivingChunks: compactedChunks,
    formattedContext,
    telemetry: {
      rrfCandidatesCount: rrfCandidates.length,
      survivingChunksCount: compactedChunks.length,
      totalOriginalTokens,
      totalCompactedTokens,
      tokensSaved: totalOriginalTokens - totalCompactedTokens,
    },
  };
}

// CLI Test Runner
if (process.argv[1] && process.argv[1].endsWith('compactor.js')) {
  (async () => {
    const testQueries = [
      'How does adding jitter prevent the thundering herd problem during service retries?',
      'What database engine did the speaker recommend for storing biometric fingerprint data?',
    ];

    for (const q of testQueries) {
      console.log(`\n========================================`);
      console.log(`[Compactor Test] Query: "${q}"`);
      const result = await retrieveAndCompact(q, 5);

      console.log(
        `[Telemetry] RRF Candidates: ${result.telemetry.rrfCandidatesCount} -> Surviving Chunks: ${result.telemetry.survivingChunksCount} | Tokens: ${result.telemetry.totalOriginalTokens} -> ${result.telemetry.totalCompactedTokens} (Saved: ${result.telemetry.tokensSaved})`
      );

      if (result.survivingChunks.length === 0) {
        console.log(
          `[Gate Decision] 0 chunks passed Cross-Encoder threshold (${RELEVANCE_THRESHOLD}) -> Will trigger is_abstained: true`
        );
      } else {
        for (const c of result.survivingChunks) {
          console.log(
            ` -> Kept ${c.chunk_id} | Cross-Encoder Score: ${c.cross_encoder_score.toFixed(
              2
            )} | RRF Score: ${c.rrf_score.toFixed(6)}`
          );
        }
        console.log(`\n[Formatted Context Window]:\n${result.formattedContext}`);
      }
    }
  })()
    .catch((err) => {
      console.error('[Compactor Error]:', err.message);
      process.exitCode = 1;
    })
    .finally(() => closeDB());
}