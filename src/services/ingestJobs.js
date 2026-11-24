// File: src/services/ingestJobs.js
import crypto from 'node:crypto';

const jobs = new Map();
const JOB_RETENTION_MS = 15 * 60 * 1000; // Keep finished job status for 15 min

function scheduleCleanup(jobId) {
  const timer = setTimeout(() => {
    jobs.delete(jobId);
  }, JOB_RETENTION_MS);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }
}

function broadcast(entry, eventName) {
  for (const listener of entry.listeners) {
    try {
      listener(eventName, entry.job);
    } catch {
      // Ignore disconnected SSE listeners
    }
  }
}

/**
 * Starts a tenant-scoped background ingestion job and returns its initial state immediately.
 */
export function startIngestJob({ userId, type, initialTitle, runner }) {
  const jobId = crypto.randomUUID();
  const ownerId = String(userId || 'system');

  const job = {
    jobId,
    userId: ownerId,
    type, // 'youtube' | 'pdf'
    status: 'running', // 'running' | 'completed' | 'failed'
    stage: 'extracting',
    title: initialTitle || (type === 'pdf' ? 'PDF Document' : 'YouTube Lecture'),
    videoId: null,
    percent: 5,
    currentBatch: 0,
    totalBatches: 0,
    savedChunks: 0,
    totalChunks: 0,
    cooldownEndsAt: null,
    message:
      type === 'pdf'
        ? 'Extracting text, tables & diagrams via Gemini 2.5 Flash...'
        : 'Extracting YouTube transcript & metadata...',
    result: null,
    error: null,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    completedAt: null,
  };

  const entry = { job, listeners: new Set() };
  jobs.set(jobId, entry);

  const onProgress = (update = {}) => {
    if (entry.job.status !== 'running') return;
    Object.assign(entry.job, update, { updatedAt: Date.now() });
    broadcast(entry, 'progress');
  };

  Promise.resolve()
    .then(() => runner(onProgress))
    .then((result) => {
      const chunksCount = result?.chunksCount ?? entry.job.totalChunks ?? 0;
      const finalTitle = result?.title || entry.job.title;
      Object.assign(entry.job, {
        status: 'completed',
        stage: 'completed',
        title: finalTitle,
        videoId: result?.videoId || entry.job.videoId,
        percent: 100,
        savedChunks: chunksCount,
        totalChunks: chunksCount,
        cooldownEndsAt: null,
        message: `Success! Ingested "${finalTitle}" (${chunksCount} chunks).`,
        result: {
          status: 'ok',
          video_id: result?.videoId,
          title: finalTitle,
          chunks_count: chunksCount,
          chunksCount,
        },
        completedAt: Date.now(),
        updatedAt: Date.now(),
      });
      broadcast(entry, 'complete');
      entry.listeners.clear();
      scheduleCleanup(jobId);
    })
    .catch((err) => {
      const errorMsg = err?.message || 'Ingestion failed';
      Object.assign(entry.job, {
        status: 'failed',
        stage: 'failed',
        cooldownEndsAt: null,
        error: errorMsg,
        message: errorMsg,
        completedAt: Date.now(),
        updatedAt: Date.now(),
      });
      broadcast(entry, 'error');
      entry.listeners.clear();
      scheduleCleanup(jobId);
    });

  return job;
}

/**
 * Looks up a job strictly owned by the authenticated user.
 */
export function getIngestJobForUser(jobId, userId) {
  const entry = jobs.get(jobId);
  if (!entry || entry.job.userId !== String(userId)) {
    return null;
  }
  return entry;
}

/**
 * Returns active (running) ingestion jobs owned by the authenticated user.
 */
export function getActiveIngestJobsForUser(userId) {
  const ownerId = String(userId);
  const active = [];
  for (const entry of jobs.values()) {
    if (entry.job.userId === ownerId && entry.job.status === 'running') {
      active.push(entry.job);
    }
  }
  return active.sort((a, b) => b.startedAt - a.startedAt);
}

/**
 * Subscribes an SSE listener to live job progress updates.
 */
export function subscribeToIngestJob(entry, listener) {
  entry.listeners.add(listener);
  return () => {
    entry.listeners.delete(listener);
  };
}