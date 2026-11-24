// File: src/server.js
import { setDefaultResultOrder } from 'node:dns';
import { setDefaultAutoSelectFamily } from 'node:net';
setDefaultResultOrder('ipv4first');
setDefaultAutoSelectFamily(false);
import crypto from 'node:crypto';
import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import multer from 'multer';
import dotenv from 'dotenv';
import { generateGroundedAnswer } from './generation/generator.js';
import { retrieveAndCompact } from './retrieval/compactor.js';
import {
  telemetryMiddleware,
  recordQueryTelemetry,
  getTelemetrySummary,
} from './middleware/telemetry.js';
import {
  connectDB,
  closeDB,
  getChunksCollection,
  ensureStandardIndexes,
  ensureTelemetryIndexes,
} from './config/db.js';

import {
  registerUser,
  loginUser,
  createGuestSession,
  cleanupGuestSession,
  resolveTokenExpiresAt,
  requireAuth,
} from './services/auth.js';
import path from 'node:path';

import { ingestVideo } from './ingestion/ytIngest.js';
import { ingestPdf } from './ingestion/pdfIngest.js';
import {
  startIngestJob,
  getIngestJobForUser,
  getActiveIngestJobsForUser,
  subscribeToIngestJob,
} from './services/ingestJobs.js';



dotenv.config({ quiet: true });

export const app = express();
app.use(express.json());
app.use(telemetryMiddleware);

// Proxy /ws/voice WebSocket connections to the local Python Voice Sidecar
const VOICE_SERVICE_URL = process.env.VOICE_SERVICE_URL || 'http://127.0.0.1:8010';
const voiceWsProxy = createProxyMiddleware({
  target: VOICE_SERVICE_URL,
  ws: true,
  changeOrigin: true,
  pathFilter: '/ws',
});
app.use(voiceWsProxy);

// Configure Multer in-memory upload (up to 25 MB PDFs)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const frontendDistPath = path.resolve('omnirag-frontend/dist');
app.use(express.static(frontendDistPath));


/**
 * 1A. UI Endpoint for Non-Blocking YouTube Ingestion (User-Scoped Background Job)
 */
app.post('/api/ingest', requireAuth, async (req, res) => {
  try {
    const { videoUrl } = req.body || {};
    if (!videoUrl) {
      return res.status(400).json({ error: 'videoUrl is required' });
    }

    const userId = String(req.user.userId);
    const expiresAt = resolveTokenExpiresAt(req.user);
    const job = startIngestJob({
      userId,
      type: 'youtube',
      initialTitle: 'YouTube Lecture',
      runner: (onProgress) =>
        ingestVideo({ videoUrl, useMock: false, userId, expiresAt, onProgress }),
    });

    return res.status(202).json({
      status: 'accepted',
      jobId: job.jobId,
      job,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * 1B. UI Endpoint for Non-Blocking PDF & Slide-Deck Ingestion (User-Scoped Background Job)
 */
app.post('/api/ingest/pdf', requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'A PDF file is required.' });
    }

    const userId = String(req.user.userId);
    const expiresAt = resolveTokenExpiresAt(req.user);
    const fileBuffer = req.file.buffer;
    const originalName = req.file.originalname || 'Document.pdf';
    const customTitle = req.body?.title || null;

    const job = startIngestJob({
      userId,
      type: 'pdf',
      initialTitle: customTitle?.trim() || originalName,
      runner: (onProgress) =>
        ingestPdf({
          fileBuffer,
          originalName,
          customTitle,
          useMock: false,
          userId,
          expiresAt,
          onProgress,
        }),
    });

    return res.status(202).json({
      status: 'accepted',
      jobId: job.jobId,
      job,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * 1C. Lists Active Background Ingestion Jobs for the Logged-In User (Refresh Recovery)
 */
app.get('/api/ingest/jobs/active', requireAuth, (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const userId = String(req.user.userId);
  return res.status(200).json({ jobs: getActiveIngestJobsForUser(userId) });
});

/**
 * 1D. SSE Stream for Live Ingestion Progress, Chunk Counters & Quota Cooldowns
 */
app.get('/api/ingest/jobs/:jobId/stream', requireAuth, (req, res) => {
  const userId = String(req.user.userId);
  const entry = getIngestJobForUser(req.params.jobId, userId);

  if (!entry) {
    return res.status(404).json({ error: 'Ingestion job not found.' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Send immediate snapshot so a reconnecting browser sees current progress right away
  if (entry.job.status === 'completed') {
    sendSseEvent(res, 'complete', entry.job);
    return res.end();
  }
  if (entry.job.status === 'failed') {
    sendSseEvent(res, 'error', entry.job);
    return res.end();
  }

  sendSseEvent(res, 'progress', entry.job);

  // Keep SSE stream alive through 62s Free Tier cooldowns on hotspots/proxies
  const heartbeat = setInterval(() => {
    res.write(': ping\n\n');
  }, 15000);

  const unsubscribe = subscribeToIngestJob(entry, (eventName, snapshot) => {
    sendSseEvent(res, eventName, snapshot);
    if (eventName === 'complete' || eventName === 'error') {
      clearInterval(heartbeat);
      unsubscribe();
      res.end();
    }
  });

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

/**
 * Helper to write formatted Server-Sent Events (SSE) frames.
 */
function sendSseEvent(res, eventName, dataPayload) {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(dataPayload)}\n\n`);
}

/**
 * 2. Health & Readiness Endpoint
 */
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'OmniRAG Agentic Pipeline',
    request_id: req.requestId,
    timestamp: new Date().toISOString(),
  });
});

/**
 * 3. SSE Grounded Generation Endpoint (User-Scoped Retrieval & Telemetry)
 */
app.post('/api/query/stream', requireAuth, async (req, res) => {
  const { query, topK = 5 } = req.body || {};

  if (!query || typeof query !== 'string' || !query.trim()) {
    return res.status(400).json({ error: 'Query string is required.' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const requestId = req.requestId || crypto.randomUUID();
  const userId = req.user?.userId ? String(req.user.userId) : null;
  const expiresAt = resolveTokenExpiresAt(req.user);
  sendSseEvent(res, 'meta', { request_id: requestId, status: 'streaming_started' });

  try {
    const result = await generateGroundedAnswer(query.trim(), {
      topK,
      userId,
      onStreamDelta: (chunk) => sendSseEvent(res, 'delta', { chunk }),
      onStreamReset: () => sendSseEvent(res, 'reset', { request_id: requestId }),
    });

    const savedTrace = await recordQueryTelemetry({
      requestId,
      userId,
      expiresAt,
      userEmail: req.user?.email || null,
      query: query.trim(),
      output: result.output,
      telemetry: result.telemetry,
    });

    sendSseEvent(res, 'complete', {
      request_id: requestId,
      output: result.output,
      telemetry: savedTrace,
    });
  } catch (err) {
    console.error('[Stream Error]:', err);
    sendSseEvent(res, 'error', { message: err.message });
  } finally {
    res.end();
  }
});


/**
 * 3B. Voice Retrieval Endpoint (User-Scoped Hybrid RRF + Cross-Encoder + Compactor)
 */
app.post('/api/retrieval/search', requireAuth, async (req, res) => {
  try {
    const { query, topK = 5 } = req.body || {};
    if (!query || typeof query !== 'string' || !query.trim()) {
      return res.status(400).json({ error: 'A non-empty "query" string is required.' });
    }

    const userId = req.user?.userId ? String(req.user.userId) : null;
    const boundedTopK = Math.max(1, Math.min(Number(topK) || 5, 10));

    const result = await retrieveAndCompact(query.trim(), boundedTopK, userId);

    const passages = (result.survivingChunks || []).map((c) => ({
      chunk_id: c.chunk_id,
      video_id: c.video_metadata?.video_id || '',
      title: c.video_metadata?.title || 'Untitled Source',
      url: c.video_metadata?.url || '',
      timestamp: c.time_bounds?.display_timestamp || '00:00',
      cross_encoder_score: Number((c.cross_encoder_score ?? 0).toFixed(3)),
      rrf_score: Number((c.rrf_score ?? 0).toFixed(6)),
      text: c.compacted_content || c.content || '',
    }));

    return res.status(200).json({
      query: result.query,
      passages,
      telemetry: result.telemetry,
    });
  } catch (err) {
    console.error('[Retrieval Search Error]:', err);
    return res.status(500).json({ error: err.message });
  }
});


/**
 * 4. Observability Dashboard Endpoint
 */
app.get('/api/telemetry/summary', requireAuth, async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const summary = await getTelemetrySummary(req.user?.userId || null);
    res.status(200).json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * 5. GET /api/resources
 * Lists ONLY the authenticated user's ingested YouTube videos and PDFs,
 * sorted with the newest ingested/updated item at the very top.
 */
app.get('/api/resources', requireAuth, async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const userId = String(req.user.userId);
    const collection = await getChunksCollection();

    const videos = await collection
      .aggregate([
        { $match: { user_id: userId } },
        {
          $group: {
            _id: '$video_metadata.video_id',
            video_id: { $first: '$video_metadata.video_id' },
            title: { $first: '$video_metadata.title' },
            url: { $first: '$video_metadata.url' },
            chunk_count: { $sum: 1 },
            latest_ingested_at: { $max: '$created_at' },
          },
        },
        { $sort: { latest_ingested_at: -1, title: 1 } },
      ])
      .toArray();

    return res.status(200).json({ videos });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * 6. DELETE /api/resources/:videoId
 * Removes ONLY the authenticated user's chunks for a specific video_id or pdf docId.
 */
app.delete('/api/resources/:videoId', requireAuth, async (req, res) => {
  try {
    const { videoId } = req.params;
    const userId = String(req.user.userId);
    const collection = await getChunksCollection();

    const result = await collection.deleteMany({
      user_id: userId,
      'video_metadata.video_id': videoId,
    });

    return res.status(200).json({
      deleted: true,
      video_id: videoId,
      deleted_chunks: result.deletedCount,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * 7. POST /api/auth/register
 */
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, username } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and security key are required.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Security key must be at least 6 characters.' });
    }

    const result = await registerUser(email, password, username);
    return res.status(201).json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

/**
 * 8. POST /api/auth/login
 */
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and security key are required.' });
    }

    const result = await loginUser(email, password);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(401).json({ error: err.message });
  }
});

/**
 * 9. POST /api/auth/guest
 * Issues a real, isolated 24h JWT for an ephemeral guest session.
 */
app.post('/api/auth/guest', (req, res) => {
  try {
    const session = createGuestSession();
    return res.status(201).json(session);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * 10. DELETE /api/auth/guest
 * Immediately clears chunks and telemetry traces for the authenticated guest session.
 */
app.delete('/api/auth/guest', requireAuth, async (req, res) => {
  try {
    if (!req.user?.isGuest) {
      return res.status(403).json({
        error: 'Forbidden: Only ephemeral guest sessions can be purged via this endpoint.',
      });
    }

    const cleanup = await cleanupGuestSession(req.user.userId);
    return res.status(200).json({ cleared: true, ...cleanup });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api') || req.path === '/health') {
    return next();
  }
  return res.sendFile(path.join(frontendDistPath, 'index.html'));
});

// Server Runner & Automated Self-Test Mode (`node src/server.js --self-test`)
if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  const PORT = Number(process.env.PORT) || 3000;
  const isSelfTest = process.argv.includes('--self-test');

  (async () => {
    await connectDB();
    await Promise.all([ensureStandardIndexes(), ensureTelemetryIndexes()]);

    const server = app.listen(PORT, async () => {
      console.log(`[Server] OmniRAG SSE API listening on http://localhost:${PORT}`);

      if (!isSelfTest) return;

      try {
        console.log('\n[Self-Test] 1. Testing POST /api/query/stream (SSE)...');
        const sseRes = await fetch(`http://localhost:${PORT}/api/query/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query:
              'How does adding jitter prevent the thundering herd problem during service retries?',
        }),
        });

        const rawStream = await sseRes.text();
        console.log('\n[SSE Stream Received]:\n' + rawStream.trim());

        console.log('\n[Self-Test] 2. Testing GET /api/telemetry/summary...');
        const summaryRes = await fetch(
          `http://localhost:${PORT}/api/telemetry/summary`
        );
        const summaryJson = await summaryRes.json();
        console.log(
          '\n[Observability Dashboard Summary]:\n' +
            JSON.stringify(summaryJson, null, 2)
        );
      } catch (err) {
        console.error('[Self-Test Error]:', err.message);
      } finally {
        server.close();
        await closeDB();
      }
    });

    server.on('upgrade', (req, socket, head) => {
      if (req.url && req.url.startsWith('/ws')) {
        voiceWsProxy.upgrade(req, socket, head);
      }
    });
  })();
}