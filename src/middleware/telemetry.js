// File: src/middleware/telemetry.js
import crypto from 'node:crypto';
import { getTelemetryCollection } from '../config/db.js';
const recentTracesBuffer = [];
const MAX_BUFFER_SIZE = 50;

/**
 * Express middleware that attaches a unique requestId and high-resolution timer
 * to every incoming HTTP request.
 */
export function telemetryMiddleware(req, res, next) {
  req.requestId = crypto.randomUUID();
  req.requestStartMs = performance.now();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

/**
 * Persists a completed RAG execution trace to MongoDB tagged with the user's ID.
 */
// export async function recordQueryTelemetry({
//   requestId,
//   userId = null,
//   userEmail = null,
//   query,
//   output,
//   telemetry,
// }) {
//   const traceDoc = {
//     request_id: requestId || crypto.randomUUID(),
//     user_id: userId,
//     user_email: userEmail,
//     timestamp: new Date(),
//     query,
//     is_abstained: Boolean(output?.is_abstained),
//     answer: output?.answer || null,
//     citations_count: output?.citations?.length || 0,
//     citations: output?.citations || [],
//     model: telemetry.model,
//     abstained_by_gate: telemetry.abstainedByGate,
//     latency_ms: {
//       retrieval: telemetry.retrievalLatencyMs,
//       ttft: telemetry.ttftMs,
//       generation: telemetry.generationLatencyMs,
//       total: telemetry.totalLatencyMs,
//     },
//     tokens: {
//       prompt: telemetry.promptTokens,
//       candidate: telemetry.candidateTokens,
//       total: telemetry.totalTokens,
//       compaction_saved: telemetry.compactionMetrics?.tokensSaved || 0,
//     },
//     estimated_cost_usd: telemetry.estimatedCostUsd,
//   };

//   recentTracesBuffer.unshift(traceDoc);
//   if (recentTracesBuffer.length > MAX_BUFFER_SIZE) {
//     recentTracesBuffer.pop();
//   }

//   try {
//     const db = await connectDB();
//     const collection = db.collection(TELEMETRY_COLLECTION);
//     await collection.createIndex({ user_id: 1, timestamp: -1 });
//     await collection.insertOne(traceDoc);
//   } catch (err) {
//     console.warn(`[Telemetry] Failed to persist trace to MongoDB: ${err.message}`);
//   }

//   return traceDoc;
// }

// Alias so any existing calls to logTelemetryTrace continue to work seamlessly

/**
 * Persists a completed RAG execution trace to MongoDB and the in-memory ring buffer.
 */
function emptyTelemetrySummary() {
  return {
    total_requests: 0,
    abstention_rate: 0,
    avg_ttft_ms: 0,
    avg_total_latency_ms: 0,
    total_tokens_consumed: 0,
    total_tokens_saved_by_compaction: 0,
    cumulative_cost_usd: 0,
    recent_traces: [],
  };
}

export async function recordQueryTelemetry({
  requestId,
  userId = null,
  expiresAt = null,
  query,
  output,
  telemetry,
}) {
  const traceDoc = {
    request_id: requestId || crypto.randomUUID(),
    user_id: userId,
    timestamp: new Date(),
    query,
    is_abstained: Boolean(output?.is_abstained),
    answer: output?.answer || null,
    citations_count: output?.citations?.length || 0,
    citations: output?.citations || [],
    model: telemetry.model,
    abstained_by_gate: telemetry.abstainedByGate,
    latency_ms: {
      retrieval: telemetry.retrievalLatencyMs,
      ttft: telemetry.ttftMs,
      generation: telemetry.generationLatencyMs,
      total: telemetry.totalLatencyMs,
    },
    tokens: {
      prompt: telemetry.promptTokens,
      candidate: telemetry.candidateTokens,
      total: telemetry.totalTokens,
      compaction_saved: telemetry.compactionMetrics?.tokensSaved || 0,
    },
    estimated_cost_usd: telemetry.estimatedCostUsd,
    ...(expiresAt instanceof Date && !Number.isNaN(expiresAt.getTime())
      ? { expires_at: expiresAt }
      : {}),
  };

  recentTracesBuffer.unshift(traceDoc);
  if (recentTracesBuffer.length > MAX_BUFFER_SIZE) {
    recentTracesBuffer.pop();
  }

  try {
    const collection = await getTelemetryCollection();
    await collection.insertOne(traceDoc);
  } catch (err) {
    console.warn(`[Telemetry] Failed to persist trace to MongoDB: ${err.message}`);
  }

  return traceDoc;
}

export const logTelemetryTrace = recordQueryTelemetry;

/**
 * Aggregates observability metrics from MongoDB scoped to a specific userId.
 */
export async function getTelemetrySummary(userId = null) {
  const ownerId = typeof userId === 'string' ? userId.trim() : '';
  if (!ownerId) {
    return emptyTelemetrySummary();
  }

  const collection = await getTelemetryCollection();
  const filter = { user_id: ownerId };

  const traces = await collection
    .find(filter, { projection: { _id: 0 } })
    .sort({ timestamp: -1 })
    .limit(100)
    .toArray();

  if (traces.length === 0) {
    return emptyTelemetrySummary();
  }

  let abstainedCount = 0;
  let generatedCount = 0;
  let sumTtftMs = 0;
  let sumTotalLatencyMs = 0;
  let totalTokens = 0;
  let totalSavedTokens = 0;
  let totalCostUsd = 0;

  for (const t of traces) {
    if (t.is_abstained) {
      abstainedCount++;
    } else {
      generatedCount++;
      sumTtftMs += t.latency_ms?.ttft || 0;
    }
    sumTotalLatencyMs += t.latency_ms?.total || 0;
    totalTokens += t.tokens?.total || 0;
    totalSavedTokens += t.tokens?.compaction_saved || 0;
    totalCostUsd += t.estimated_cost_usd || 0;
  }

  return {
    total_requests: traces.length,
    abstention_rate: Number((abstainedCount / traces.length).toFixed(4)),
    avg_ttft_ms:
      generatedCount > 0 ? Math.round(sumTtftMs / generatedCount) : 0,
    avg_total_latency_ms: Math.round(sumTotalLatencyMs / traces.length),
    total_tokens_consumed: totalTokens,
    total_tokens_saved_by_compaction: totalSavedTokens,
    cumulative_cost_usd: Number(totalCostUsd.toFixed(8)),
    recent_traces: traces.slice(0, 20),
  };
}