// File: src/services/embedder.js
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { retryOn503 } from './geminiRetry.js';

dotenv.config();

if (!process.env.GEMINI_API_KEY) {
  throw new Error('Missing GEMINI_API_KEY in .env file.');
}

// const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  apiVersion: 'v1beta',
  httpOptions: { apiVersion: 'v1beta' },
});

// const EMBEDDING_MODEL = 'text-embedding-004';
const EMBEDDING_MODEL = 'gemini-embedding-001';

/**
 * Generates a vector embedding for a document chunk during ingestion.
 * Uses RETRIEVAL_DOCUMENT taskType to optimize vector space alignment.
 *
 * @param {string} text - The chunk text to embed
 * @param {string} title - Video title for semantic context
 * @returns {Promise<number[]>} 768-dimensional float vector
 */
export async function embedDocumentChunk(text, title = '') {
  const response = await retryOn503('Embedder:Doc', () =>
    ai.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: text,
      config: {
        taskType: 'RETRIEVAL_DOCUMENT',
        title: title || undefined,
      },
    })
  );

  const values = response?.embeddings?.[0]?.values;
  if (!values || values.length === 0) {
    throw new Error('Failed to generate document embedding from @google/genai.');
  }
  return values;
}

/**
 * Generates a vector embedding for a user search query at runtime.
 * Uses RETRIEVAL_QUERY taskType to match against document embeddings.
 *
 * @param {string} query - The user's question
 * @returns {Promise<number[]>} 768-dimensional float vector
 */
export async function embedSearchQuery(query) {
  const response = await retryOn503('Embedder:Query', () =>
    ai.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: query,
      config: {
        taskType: 'RETRIEVAL_QUERY',
      },
    })
  );

  const values = response?.embeddings?.[0]?.values;
  if (!values || values.length === 0) {
    throw new Error('Failed to generate query embedding from @google/genai.');
  }
  return values;
}