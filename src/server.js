// File: src/server.js
import crypto from 'node:crypto';
import express from 'express';
import multer from 'multer';
import dotenv from 'dotenv';
import { generateGroundedAnswer } from './generation/generator.js';
import {
  telemetryMiddleware,
  recordQueryTelemetry,
  getTelemetrySummary,
} from './middleware/telemetry.js';
import { connectDB, closeDB, getChunksCollection } from './config/db.js';
import { ingestVideo } from './ingestion/ytIngest.js';
import { ingestPdf } from './ingestion/pdfIngest.js';
import { registerUser, loginUser, requireAuth } from './services/auth.js';
import path from 'node:path';


dotenv.config({ quiet: true });

export const app = express();
app.use(express.json());
app.use(telemetryMiddleware);

// Configure Multer in-memory upload (up to 25 MB PDFs)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const frontendDistPath = path.resolve('omnirag-frontend/dist');
app.use(express.static(frontendDistPath));
/**
 * 1A. UI Endpoint for YouTube Ingestion (User-Scoped)
 */
app.post('/api/ingest', requireAuth, async (req, res) => {
  try {
    const { videoUrl } = req.body || {};
    if (!videoUrl) {
      return res.status(400).json({ error: 'videoUrl is required' });
    }

    const userId = String(req.user.userId);
    const result = await ingestVideo({ videoUrl, useMock: false, userId });

    return res.json({
      status: 'ok',
      video_id: result.videoId,
      title: `${result.title} (${result.chunksCount} chunks)`,
      chunks_count: result.chunksCount,
      chunksCount: result.chunksCount,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * 1B. UI Endpoint for Multi-Modal PDF & Slide-Deck Ingestion (User-Scoped)
 */
app.post('/api/ingest/pdf', requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'A PDF file is required.' });
    }

    const userId = String(req.user.userId);
    const result = await ingestPdf({
      fileBuffer: req.file.buffer,
      originalName: req.file.originalname || 'Document.pdf',
      customTitle: req.body?.title || null,
      useMock: false,
      userId,
    });

    return res.json({
      status: 'ok',
      video_id: result.videoId,
      title: result.title,
      chunks_count: result.chunksCount,
      chunksCount: result.chunksCount,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
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
  sendSseEvent(res, 'meta', { request_id: requestId, status: 'streaming_started' });

  try {
    const result = await generateGroundedAnswer(query.trim(), {
      topK,
      userId,
      onStreamDelta: (chunk) => sendSseEvent(res, 'delta', { chunk }),
    });

    const savedTrace = await recordQueryTelemetry({
      requestId,
      userId,
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
        process.exitCode = 1;
      } finally {
        server.close();
        await closeDB();
      }
    });
  })();
}