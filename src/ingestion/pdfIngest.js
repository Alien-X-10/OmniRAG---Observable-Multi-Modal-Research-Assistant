// File: src/ingestion/pdfIngest.js
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { createVectorChunkDocument } from '../contracts/schema.js';
import { embedDocumentChunk } from '../services/embedder.js';
import {
  getChunksCollection,
  ensureStandardIndexes,
  closeDB,
} from '../config/db.js';
import { formatTimestamp } from './ytIngest.js';

dotenv.config({ quiet: true });

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  apiVersion: 'v1beta',
  httpOptions: { apiVersion: 'v1beta' },
});

const BATCH_EMBEDDING_MODEL = 'gemini-embedding-001';
const MAX_TOKENS_PER_BATCH = 22000; // Safely below Free Tier 30,000 TPM cap
const TPM_WINDOW_RESET_MS = 62000;  // 62s cooldown between batches on huge PDFs

/**
 * Generates a deterministic 8-char document ID from the PDF filename.
 */
function buildPdfDocId(fileName) {
  const clean = String(fileName || 'document.pdf')
    .toLowerCase()
    .replace(/\.pdf$/i, '')
    .trim();
  const hash = crypto.createHash('md5').update(clean).digest('hex').slice(0, 8);
  return `pdf_${hash}`;
}

/**
 * Rough token estimator (~4 chars per token).
 */
function estimateTokens(text) {
  return Math.ceil(String(text || '').trim().length / 4);
}

/**
 * Splits dense page text into ~4500-char (~1125-token) windows with 300-char overlap.
 * Stays safely below gemini-embedding-001's 2048-token max input while keeping tables intact.
 */
function splitPageIntoChunks(pageNumber, pageText, maxChars = 4500, overlapChars = 300) {
  const clean = String(pageText || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];

  if (clean.length <= maxChars) {
    return [{ pageNumber, content: `[Page ${pageNumber}] ${clean}` }];
  }

  const chunks = [];
  let start = 0;
  let part = 1;

  while (start < clean.length) {
    const slice = clean.slice(start, start + maxChars).trim();
    if (slice.length > 20) {
      chunks.push({
        pageNumber,
        part,
        content: `[Page ${pageNumber}, Part ${part}] ${slice}`,
      });
      part++;
    }
    if (start + maxChars >= clean.length) break;
    start += maxChars - overlapChars;
  }

  return chunks;
}

/**
 * Groups chunks into batches where total tokens never exceed MAX_TOKENS_PER_BATCH (22,000).
 */
function buildTokenBudgetBatches(chunks, maxTokens = MAX_TOKENS_PER_BATCH) {
  const batches = [];
  let currentBatch = [];
  let currentTokens = 0;

  for (const chunk of chunks) {
    const chunkTokens = (chunk.tokenCount || estimateTokens(chunk.content)) + 20;

    if (currentBatch.length > 0 && currentTokens + chunkTokens > maxTokens) {
      batches.push(currentBatch);
      currentBatch = [];
      currentTokens = 0;
    }

    currentBatch.push(chunk);
    currentTokens += chunkTokens;
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

/**
 * Uses Gemini 2.5 Flash's native multi-modal PDF reader with compact table/diagram extraction.
 */
async function extractPdfPagesViaGemini(fileBuffer, displayTitle) {
  const base64Pdf = fileBuffer.toString('base64');

  console.log(
    `[PDF Ingest] Running compact multi-modal text, table & diagram extraction for "${displayTitle}"...`
  );

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [
      {
        inlineData: {
          data: base64Pdf,
          mimeType: 'application/pdf',
        },
      },
      {
        text: `Extract a complete, high-density technical knowledge base from "${displayTitle}".

STRICT OUTPUT RULES:
1. Do NOT output JSON or markdown code blocks.
2. Process chronologically page by page, starting every page on a new line as:
[PAGE 1] ...
[PAGE 2] ...
3. Format tables, routines, and schedules as compact pipe-separated rows (e.g., Day | Time | Course | Room | Faculty) with ZERO repetitive prose filler.
4. Preserve every exact code, number, date, equation, and concise technical description of any diagrams or charts.`,
      },
    ],
    config: {
      temperature: 0.0,
      maxOutputTokens: 65536,
    },
  });

  const rawText = String(response.text || '').trim();
  if (!rawText) {
    throw new Error('Gemini returned empty text for the uploaded PDF.');
  }

  const pageBlocks = [];
  const pageRegex = /\[PAGE\s+(\d+)\]\s*([\s\S]*?)(?=\n\s*\[PAGE\s+\d+\]|$)/gi;
  let match;

  while ((match = pageRegex.exec(rawText)) !== null) {
    const pageNumber = parseInt(match[1], 10);
    const content = match[2].replace(/\s+/g, ' ').trim();
    if (!Number.isNaN(pageNumber) && content.length > 5) {
      pageBlocks.push({ pageNumber, content });
    }
  }

  if (pageBlocks.length === 0) {
    const paragraphs = rawText
      .split(/\n{2,}/)
      .map((p) => p.replace(/\s+/g, ' ').trim())
      .filter((p) => p.length > 20);

    paragraphs.forEach((p, idx) => {
      pageBlocks.push({ pageNumber: idx + 1, content: p });
    });
  }

  const finalChunks = [];
  for (const block of pageBlocks) {
    finalChunks.push(...splitPageIntoChunks(block.pageNumber, block.content));
  }

  return finalChunks;
}

/**
 * Extracts exact retry cooldown (in ms) from Gemini 429 RESOURCE_EXHAUSTED errors.
 */
function getRateLimitWaitMs(err, attempt) {
  const msg = String(err?.message || '');
  const secondsMatch = msg.match(/retry in\s+([\d.]+)s/i);
  if (secondsMatch) {
    const parsedSec = parseFloat(secondsMatch[1]);
    if (!Number.isNaN(parsedSec)) {
      return Math.ceil(parsedSec * 1000) + 2000;
    }
  }

  if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota')) {
    return 62000;
  }

  return 1500 * attempt;
}

/**
 * Embeds a token-safe batch of chunks in a SINGLE API request.
 */
async function embedChunksBatchWithRetry(chunks, title, retries = 3) {
  const contentsWithTitle = chunks.map((c) => `Document: ${title}\n${c.content}`);

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await ai.models.embedContent({
        model: BATCH_EMBEDDING_MODEL,
        contents: contentsWithTitle,
        config: {
          taskType: 'RETRIEVAL_DOCUMENT',
        },
      });

      const embeddings = response?.embeddings || [];
      if (embeddings.length !== chunks.length) {
        throw new Error(
          `Batch embedding count mismatch: expected ${chunks.length}, got ${embeddings.length}`
        );
      }

      return embeddings.map((e, idx) => {
        if (!e?.values || e.values.length === 0) {
          throw new Error(`Empty embedding vector returned at batch index ${idx}`);
        }
        return e.values;
      });
    } catch (err) {
      if (attempt < retries) {
        const waitMs = getRateLimitWaitMs(err, attempt);
        console.warn(
          `[PDF Ingest] Batch embedding transient/rate error (attempt ${attempt}/${retries}). Waiting ${(
            waitMs / 1000
          ).toFixed(1)}s...`
        );
        await new Promise((r) => setTimeout(r, waitMs));
      } else {
        console.warn('[PDF Ingest] Falling back to individual chunk embedding...');
        return Promise.all(chunks.map((c) => embedDocumentChunk(c.content, title)));
      }
    }
  }
}

/**
 * Built-in mock PDF lecture slides for quick CLI sandbox verification (--mock).
 */
function getMockPdfData() {
  return {
    docId: 'pdf_raft01',
    title: '[PDF] Raft Consensus & Replicated State Machines (Lecture Slides)',
    url: 'https://omnirag.local/documents/pdf_raft01',
    rawChunks: [
      {
        pageNumber: 1,
        content:
          '[Page 1] Raft Consensus Algorithm Overview: Raft separates consensus into three distinct sub-problems: Leader Election, Log Replication, and Safety. Slide diagram shows three node states: Follower, Candidate, and Leader, with randomized election timeouts between 150ms and 300ms preventing split votes.',
      },
      {
        pageNumber: 2,
        content:
          '[Page 2] Log Replication & Commit Quorum: The Leader accepts client commands, appends them to its log as uncommitted entries, and sends AppendEntries RPCs in parallel to all Followers. Once a majority quorum (N/2 + 1 nodes) acknowledges the entry, the Leader commits the log entry and applies it to its local state machine.',
      },
    ],
  };
}

/**
 * Main PDF Ingestion Pipeline
 */
/**
 * Retries transient MongoDB Atlas network/socket timeouts on a fresh socket.
 */
async function withMongoRetryPdf(operationName, fn, retries = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || '');
      const isNetworkErr =
        err?.name?.includes('MongoNetwork') ||
        msg.includes('timed out') ||
        msg.includes('ECONNRESET') ||
        msg.includes('socket');

      if (!isNetworkErr || attempt === retries) {
        throw err;
      }
      console.warn(
        `[PDF Ingest] MongoDB ${operationName} timed out (attempt ${attempt}/${retries}); retrying on fresh socket...`
      );
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  throw lastErr;
}

/**
 * Main PDF Ingestion Pipeline (Token-Safe Batch Embedding + Sliced MongoDB Writes + Live Progress)
 */
export async function ingestPdf({
  filePath = null,
  fileBuffer = null,
  originalName = 'Document.pdf',
  customTitle = null,
  useMock = false,
  userId = 'system',
  expiresAt = null,
  onProgress = null,
} = {}) {
  const ownerId = String(userId || 'system');
  const report = (payload) => {
    if (typeof onProgress === 'function') {
      try {
        onProgress(payload);
      } catch {
        // Never interrupt ingestion if a progress subscriber disconnects
      }
    }
  };

  const initialTitle = customTitle?.trim() || originalName || 'PDF Document';
  report({
    stage: 'extracting',
    title: initialTitle,
    videoId: null,
    percent: 8,
    currentBatch: 0,
    totalBatches: 0,
    savedChunks: 0,
    totalChunks: 0,
    cooldownEndsAt: null,
    message: 'Extracting text, tables & diagrams via Gemini 2.5 Flash...',
  });

  await withMongoRetryPdf('ensureStandardIndexes', () => ensureStandardIndexes());
  const collection = await getChunksCollection();

  let docId;
  let title;
  let url;
  let rawChunks;

  if (useMock) {
    console.log('[PDF Ingest] Loading mock PDF slide deck for sandbox verification...');
    const mock = getMockPdfData();
    docId = mock.docId;
    title = mock.title;
    url = mock.url;
    rawChunks = mock.rawChunks;
  } else {
    const buffer = fileBuffer || (await fs.readFile(filePath));
    const baseName = path.basename(originalName || filePath || 'Document.pdf', '.pdf');
    docId = buildPdfDocId(baseName);
    const cleanTitle = (customTitle || baseName).trim();
    title = cleanTitle.startsWith('[PDF]') ? cleanTitle : `[PDF] ${cleanTitle}`;
    url = `https://omnirag.local/documents/${docId}`;
    rawChunks = await extractPdfPagesViaGemini(buffer, title);
  }

  if (!rawChunks || rawChunks.length === 0) {
    throw new Error(`No extractable content found in PDF "${title}".`);
  }

  const preparedChunks = rawChunks.map((chunk, index) => {
    const markerSeconds = index + 1;
    return {
      ...chunk,
      startSeconds: markerSeconds,
      endSeconds: markerSeconds + 1,
      displayTimestamp: formatTimestamp(markerSeconds),
      tokenCount: estimateTokens(chunk.content),
    };
  });

  const batches = buildTokenBudgetBatches(preparedChunks, MAX_TOKENS_PER_BATCH);
  const totalChunks = Math.max(1, preparedChunks.length);

  console.log(
    `[PDF Ingest] Created ${preparedChunks.length} chunks across ${batches.length} token-safe batch(es) for "${title}".`
  );

  report({
    stage: 'chunking',
    title,
    videoId: docId,
    percent: 25,
    currentBatch: 0,
    totalBatches: batches.length,
    savedChunks: 0,
    totalChunks: preparedChunks.length,
    cooldownEndsAt: null,
    message: `Prepared ${preparedChunks.length} page chunks across ${batches.length} batch(es).`,
  });

  const WRITE_SLICE_SIZE = 20;
  let totalMatched = 0;
  let totalUpserted = 0;
  let savedChunks = 0;

  for (let bIdx = 0; bIdx < batches.length; bIdx++) {
    const batch = batches[bIdx];
    const batchNum = bIdx + 1;
    const batchTokens = batch.reduce((sum, c) => sum + c.tokenCount, 0);

    console.log(
      `[PDF Ingest] Embedding batch #${batchNum}/${batches.length} (${batch.length} chunks, ~${batchTokens} tokens)...`
    );

    report({
      stage: 'embedding',
      title,
      videoId: docId,
      percent: Math.min(92, 25 + Math.round((savedChunks / totalChunks) * 70)),
      currentBatch: batchNum,
      totalBatches: batches.length,
      savedChunks,
      totalChunks: preparedChunks.length,
      cooldownEndsAt: null,
      message: `Embedding Batch ${batchNum}/${batches.length} (${batch.length} chunks)...`,
    });

    const vectors = await embedChunksBatchWithRetry(batch, title);

    const batchOperations = batch.map((chunk, j) => {
      const validatedDoc = createVectorChunkDocument({
        userId: ownerId,
        videoId: docId,
        title,
        url,
        startSeconds: chunk.startSeconds,
        endSeconds: chunk.endSeconds,
        displayTimestamp: chunk.displayTimestamp,
        content: chunk.content,
        embedding: vectors[j],
        tokenCount: chunk.tokenCount,
        expiresAt,
      });

      return {
        updateOne: {
          filter: { user_id: ownerId, chunk_id: validatedDoc.chunk_id },
          update: { $set: validatedDoc },
          upsert: true,
        },
      };
    });

    if (bIdx === 0) {
      await withMongoRetryPdf('deleteMany', () =>
        collection.deleteMany({
          user_id: ownerId,
          'video_metadata.video_id': docId,
        })
      );
    }

    for (let s = 0; s < batchOperations.length; s += WRITE_SLICE_SIZE) {
      const slice = batchOperations.slice(s, s + WRITE_SLICE_SIZE);
      const res = await withMongoRetryPdf(
        `bulkWrite batch ${batchNum} (${s + 1}-${s + slice.length})`,
        () => collection.bulkWrite(slice, { ordered: false })
      );
      totalMatched += res.matchedCount || 0;
      totalUpserted += res.upsertedCount || 0;
      savedChunks += slice.length;

      report({
        stage: 'saving',
        title,
        videoId: docId,
        percent: Math.min(97, 25 + Math.round((savedChunks / totalChunks) * 72)),
        currentBatch: batchNum,
        totalBatches: batches.length,
        savedChunks,
        totalChunks: preparedChunks.length,
        cooldownEndsAt: null,
        message: `Batch ${batchNum}/${batches.length} · ${savedChunks} / ${preparedChunks.length} chunks saved`,
      });
    }

    if (bIdx < batches.length - 1) {
      const cooldownEndsAt = Date.now() + TPM_WINDOW_RESET_MS;
      console.log(
        `[PDF Ingest] Pausing ${TPM_WINDOW_RESET_MS / 1000}s before batch #${batchNum + 1}/${batches.length} so Free Tier 30k TPM window resets...`
      );

      report({
        stage: 'cooldown',
        title,
        videoId: docId,
        percent: Math.min(97, 25 + Math.round((savedChunks / totalChunks) * 72)),
        currentBatch: batchNum,
        totalBatches: batches.length,
        savedChunks,
        totalChunks: preparedChunks.length,
        cooldownEndsAt,
        message: `Batch ${batchNum}/${batches.length} · ${savedChunks} / ${preparedChunks.length} chunks saved`,
      });

      await new Promise((r) => setTimeout(r, TPM_WINDOW_RESET_MS));
    }
  }

  console.log(
    `[PDF Ingest] Upsert complete in ${batches.length} embedding API call(s) -> Matched: ${totalMatched}, Upserted: ${totalUpserted}`
  );

  report({
    stage: 'completed',
    title,
    videoId: docId,
    percent: 100,
    currentBatch: batches.length,
    totalBatches: batches.length,
    savedChunks: preparedChunks.length,
    totalChunks: preparedChunks.length,
    cooldownEndsAt: null,
    message: `Indexed "${title}" (${preparedChunks.length} chunks).`,
  });

  return {
    videoId: docId,
    title,
    chunksCount: preparedChunks.length,
  };
}

// CLI Entrypoint
if (process.argv[1] && process.argv[1].endsWith('pdfIngest.js')) {
  const arg = process.argv[2];
  const useMock = arg === '--mock' || !arg;

  ingestPdf({
    filePath: useMock ? null : arg,
    originalName: useMock ? 'Raft_Slides.pdf' : path.basename(arg),
    useMock,
  })
    .catch((err) => {
      console.error('[PDF Ingest Error]:', err.message);
      process.exitCode = 1;
    })
    .finally(() => closeDB());
}