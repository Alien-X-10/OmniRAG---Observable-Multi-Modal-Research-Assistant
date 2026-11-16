// File: src/server.js
import crypto from 'node:crypto';
import express from 'express';
import dotenv from 'dotenv';
import { generateGroundedAnswer } from './generation/generator.js';
import {
  telemetryMiddleware,
  recordQueryTelemetry,
  getTelemetrySummary,
} from './middleware/telemetry.js';
import { connectDB, closeDB, getChunksCollection } from './config/db.js';
import { ingestVideo } from './ingestion/ytIngest.js';
import { registerUser, loginUser, requireAuth } from './services/auth.js';

dotenv.config({ quiet: true });

export const app = express();
app.use(express.json());
app.use(telemetryMiddleware);

app.use(express.static('public'));
app.get('/', (req, res) => res.sendFile('index.html', { root: 'public' }));

/**
 * UI Endpoint for YouTube Ingestion
 * Returns the actual extracted title, videoId, and chunk count.
 */
app.post('/api/ingest', async (req, res) => {
  try {
    const { videoUrl } = req.body || {};
    if (!videoUrl) {
      return res.status(400).json({ error: 'videoUrl is required' });
    }

    const result = await ingestVideo({ videoUrl, useMock: false });

    return res.json({
      status: 'ok',
      video_id: result.videoId,
      title: `${result.title} (${result.chunksCount} chunks)`,
      chunks_count: result.chunksCount,
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
 * 1. Health & Readiness Endpoint
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
 * 2. SSE Grounded Generation Endpoint
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
  sendSseEvent(res, 'meta', { request_id: requestId, status: 'streaming_started' });

  try {
    const result = await generateGroundedAnswer(query.trim(), {
      topK,
      onStreamDelta: (chunk) => sendSseEvent(res, 'delta', { chunk }),
    });

    const savedTrace = await recordQueryTelemetry({
      requestId,
      userId: req.user?.userId || null,
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
 * 3. Observability Dashboard Endpoint
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
 * 4. GET /api/resources
 * Aggregates all ingested YouTube videos in video_chunks by video_id,
 * sorted with the newest ingested/updated video at the very top.
 */
app.get('/api/resources', requireAuth, async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const collection = await getChunksCollection();
    const videos = await collection
      .aggregate([
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
 * 5. DELETE /api/resources/:videoId
 * Removes all chunks for a specific video_id from MongoDB.
 */
app.delete('/api/resources/:videoId', requireAuth, async (req, res) => {
  try {
    const { videoId } = req.params;
    const collection = await getChunksCollection();
    const result = await collection.deleteMany({
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
 * 6. POST /api/auth/register
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
 * 7. POST /api/auth/login
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