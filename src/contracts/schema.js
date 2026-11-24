// File: argon/src/contracts/schemas.js
// import { Type } from '@google/genai';
// import { GoogleGenAI } from '@google/genai';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config(); // Load the .env file

// Pass the API key from your .env file to the client
// const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }); 
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  apiVersion: 'v1beta',
  httpOptions: { apiVersion: 'v1beta' },
});
/**
 * 1. Gemini 2.5 Flash Strict Structured Output Schema
 * Passed directly into generationConfig.responseSchema to guarantee
 * deterministic JSON and enforce the abstention path.
 */
export const RAG_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    is_abstained: {
      type: Type.BOOLEAN,
      description:
        'Set to true ONLY if the provided context chunks do not contain the factual answer. If true, answer must be null.',
    },
    answer: {
      type: Type.STRING,
      nullable: true,
      description:
        'The grounded response using ONLY the provided chunks. Every factual claim must include an inline citation formatted strictly as <chunk id="vid_ID_mm:ss">. Must be null if is_abstained is true.',
    },
    citations: {
      type: Type.ARRAY,
      description:
        'List of exact chunks cited in the answer. Must be empty if is_abstained is true.',
      items: {
        type: Type.OBJECT,
        properties: {
          chunk_id: {
            type: Type.STRING,
            description: 'Unique chunk identifier, e.g., vid_72x_14:32',
          },
          video_id: {
            type: Type.STRING,
            description: 'YouTube video ID, e.g., 72x',
          },
          timestamp: {
            type: Type.STRING,
            description: 'Timestamp in mm:ss or hh:mm:ss format, e.g., 14:32',
          },
        },
        required: ['chunk_id', 'video_id', 'timestamp'],
      },
    },
  },
  required: ['is_abstained', 'answer', 'citations'],
};

/**
 * Regex pattern to verify chunk ID format: vid_<videoId>_<mm:ss>
 */
export const CHUNK_ID_REGEX = /^vid_[a-zA-Z0-9_-]+_\d{1,2}:\d{2}(:\d{2})?$/;

/**
 * 2. Runtime Guardrail for LLM Output
 * Double-checks that Gemini didn't hallucinate an answer while flagging abstention,
 * or emit an answer without valid citations.
 */
export function validateLLMOutput(payload) {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('Invalid LLM output: Payload must be a JSON object.');
  }

  if (payload.is_abstained === true) {
    if (payload.answer !== null || (payload.citations && payload.citations.length > 0)) {
      throw new Error(
        'Contract Violation: When is_abstained is true, answer must be null and citations must be empty.'
      );
    }
    return true;
  }

  if (!payload.answer || payload.answer.trim().length === 0) {
    throw new Error(
      'Contract Violation: When is_abstained is false, a non-empty answer is required.'
    );
  }

  if (!Array.isArray(payload.citations) || payload.citations.length === 0) {
    throw new Error(
      'Contract Violation: Grounded answers must include at least one citation object.'
    );
  }

  for (const citation of payload.citations) {
    if (!CHUNK_ID_REGEX.test(citation.chunk_id)) {
      throw new Error(`Invalid chunk_id format in citation: ${citation.chunk_id}`);
    }
    const inlineTag = `<chunk id="${citation.chunk_id}">`;
    if (!payload.answer.includes(inlineTag)) {
      throw new Error(
        `Citation Mismatch: Citation ${citation.chunk_id} is listed in citations[] but missing inline tag ${inlineTag} in answer text.`
      );
    }
  }

  return true;
}

/**
 * 3. MongoDB Vector Document Factory & Validator
 * Ensures every chunk ingested via yt-dlp conforms to the Atlas Hybrid Search contract.
 */
// export function createVectorChunkDocument({
//   videoId,
//   title,
//   url,
//   startSeconds,
//   endSeconds,
//   displayTimestamp,
//   content,
//   embedding,
//   tokenCount,
// }) {
export function createVectorChunkDocument({
  userId = 'system',
  videoId,
  title,
  url,
  startSeconds,
  endSeconds,
  displayTimestamp,
  content,
  embedding,
  tokenCount,
}) {
  const chunkId = `vid_${videoId}_${displayTimestamp}`;

  if (!CHUNK_ID_REGEX.test(chunkId)) {
    throw new Error(`Generated chunk_id "${chunkId}" failed format validation.`);
  }

  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error(`Invalid embedding vector for chunk "${chunkId}".`);
  }

  return {
    user_id: String(userId || 'system'),
    chunk_id: `vid_${videoId}_${displayTimestamp}`,
    video_metadata: {
      video_id: videoId,
      title,
      url,
    },
    time_bounds: {
      start_seconds: startSeconds,
      end_seconds: endSeconds,
      display_timestamp: displayTimestamp,
    },
    content,
    embedding,
    token_count: tokenCount,
    created_at: new Date(),
  };
}