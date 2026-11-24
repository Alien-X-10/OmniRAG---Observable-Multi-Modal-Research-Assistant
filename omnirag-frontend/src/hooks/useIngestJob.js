// File: omnirag-frontend/src/hooks/useIngestJob.js
import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Manages live SSE progress streaming & page-refresh recovery for background ingestion jobs.
 */
export function useIngestJob(isAuthenticated) {
  const [activeJob, setActiveJob] = useState(null);
  const abortRef = useRef(null);
  const dismissTimerRef = useRef(null);

  const stopStream = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  const clearDismissTimer = useCallback(() => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  }, []);

  const dismissJob = useCallback(() => {
    clearDismissTimer();
    stopStream();
    setActiveJob(null);
  }, [clearDismissTimer, stopStream]);

  const subscribeToJob = useCallback(
    async (jobId) => {
      if (!jobId) return;

      stopStream();
      clearDismissTimer();

      const token = localStorage.getItem('omnirag_token') || '';
      if (!token) return;

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch(
          `/api/ingest/jobs/${encodeURIComponent(jobId)}/stream`,
          {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'text/event-stream',
            },
            signal: controller.signal,
          }
        );

        if (!res.ok || !res.body) {
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split('\n\n');
          buffer = frames.pop() || '';

          for (const frame of frames) {
            const lines = frame.split('\n');
            let eventName = 'progress';
            let dataLine = '';

            for (const line of lines) {
              if (line.startsWith(':')) continue; // Ignore heartbeat pings
              if (line.startsWith('event:')) {
                eventName = line.slice(6).trim();
              } else if (line.startsWith('data:')) {
                dataLine += line.slice(5).trim();
              }
            }

            if (!dataLine) continue;

            try {
              const payload = JSON.parse(dataLine);
              setActiveJob(payload);

              if (eventName === 'complete' || payload.status === 'completed') {
                window.dispatchEvent(new Event('omnirag:refresh-corpus'));
                clearDismissTimer();
                dismissTimerRef.current = setTimeout(() => {
                  setActiveJob((prev) =>
                    prev?.jobId === payload.jobId && prev.status === 'completed'
                      ? null
                      : prev
                  );
                }, 9000);
              }
            } catch {
              // Ignore malformed SSE frame
            }
          }
        }
      } catch (err) {
        if (err?.name !== 'AbortError') {
          console.warn('[Ingest SSE] Stream disconnected:', err?.message);
        }
      }
    },
    [stopStream, clearDismissTimer]
  );

  const startTrackingJob = useCallback(
    (initialJob) => {
      if (!initialJob?.jobId) return;
      clearDismissTimer();
      setActiveJob(initialJob);
      subscribeToJob(initialJob.jobId);
    },
    [clearDismissTimer, subscribeToJob]
  );

  // Page-refresh recovery: reconnect automatically if an upload is already running for this user
  useEffect(() => {
    if (!isAuthenticated) {
      dismissJob();
      return;
    }

    let cancelled = false;
    const token = localStorage.getItem('omnirag_token') || '';
    if (!token) return;

    (async () => {
      try {
        const res = await fetch('/api/ingest/jobs/active', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const runningJob = data?.jobs?.[0];
        if (runningJob && !cancelled) {
          setActiveJob(runningJob);
          subscribeToJob(runningJob.jobId);
        }
      } catch {
        // Ignore if backend is offline
      }
    })();

    return () => {
      cancelled = true;
      stopStream();
      clearDismissTimer();
    };
  }, [isAuthenticated, subscribeToJob, stopStream, clearDismissTimer, dismissJob]);

  return {
    activeJob,
    startTrackingJob,
    dismissJob,
  };
}