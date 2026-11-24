// File: omnirag-frontend/src/components/Modals.jsx
import React, { useState, useEffect } from 'react';

/**
 * Live ticking countdown (in seconds) for Gemini Free Tier quota resets.
 */
function useCooldownSeconds(cooldownEndsAt) {
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (!cooldownEndsAt) {
      setSecondsLeft(0);
      return;
    }

    const update = () => {
      const remaining = Math.max(0, Math.ceil((cooldownEndsAt - Date.now()) / 1000));
      setSecondsLeft(remaining);
    };

    update();
    const timer = setInterval(update, 500);
    return () => clearInterval(timer);
  }, [cooldownEndsAt]);

  return secondsLeft;
}

/**
 * Sleek Pitch-Black & Neon Emerald Authentication Modal
 */
export function AuthModal({ isOpen, onClose, currentUsername, onSignIn }) {
  const [inputName, setInputName] = useState(currentUsername || '');

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    const cleaned = inputName.trim().toLowerCase().replace(/\s+/g, '_');
    if (!cleaned) return;
    onSignIn(cleaned);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm rounded-2xl bg-midnight-950 border border-neon-500/80 shadow-emerald-input p-6 relative animate-fadeIn">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-500 hover:text-gray-300 text-sm"
        >
          ✕
        </button>

        <h3 className="text-lg font-medium text-center text-gray-100 mb-5">
          Authentication
        </h3>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-300 mb-1.5">
              Username
            </label>
            <input
              type="text"
              value={inputName}
              onChange={(e) => setInputName(e.target.value)}
              placeholder="e.g., jeff_brokaw"
              autoFocus
              className="w-full rounded-xl bg-midnight-900/90 border border-neon-500/80 shadow-emerald-glow px-3.5 py-2.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-neon-400"
            />
          </div>

          <button
            type="submit"
            className="w-full py-2.5 rounded-xl bg-midnight-900 border border-midnight-700 hover:border-neon-500/60 text-sm font-medium text-gray-200 hover:text-neon-400 transition-all"
          >
            Sign In
          </button>
        </form>
      </div>
    </div>
  );
}

/**
 * Multi-Modal Lecture & Document Ingestion Modal (+ Ingest)
 * Supports Live Progress Bar, Quota Countdown & Non-Blocking "Run in Background".
 */
export function IngestModal({
  isOpen,
  onClose,
  activeJob = null,
  onStartJob,
  onDismissJob,
}) {
  const [ingestMode, setIngestMode] = useState('youtube'); // 'youtube' | 'pdf'
  const [videoUrl, setVideoUrl] = useState('');
  const [pdfFile, setPdfFile] = useState(null);
  const [pdfTitle, setPdfTitle] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localError, setLocalError] = useState(null);

  const cooldownSec = useCooldownSeconds(activeJob?.cooldownEndsAt);

  // Sync tab indicator when re-opening modal for an active background job
  useEffect(() => {
    if (isOpen && activeJob?.type) {
      setIngestMode(activeJob.type);
    }
  }, [isOpen, activeJob?.type]);

  if (!isOpen) return null;

  const isRunning = activeJob?.status === 'running';
  const isCompleted = activeJob?.status === 'completed';
  const isFailed = activeJob?.status === 'failed';
  const isBusy = isSubmitting || isRunning;

  const switchMode = (mode) => {
    if (isBusy) return;
    setIngestMode(mode);
    setLocalError(null);
  };

  const handleIngest = async (e) => {
    e.preventDefault();
    if (isBusy) return;

    const token = localStorage.getItem('omnirag_token') || '';
    setLocalError(null);

    if (ingestMode === 'youtube') {
      const trimmed = videoUrl.trim();
      if (!trimmed) return;

      setIsSubmitting(true);
      try {
        const res = await fetch('/api/ingest', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ videoUrl: trimmed }),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || data.message || 'Ingestion failed');
        }

        setVideoUrl('');
        if (onStartJob && data.job) {
          onStartJob(data.job);
        }
      } catch (err) {
        setLocalError(err.message);
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    // PDF / Slide-Deck Mode
    if (!pdfFile) return;

    setIsSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('file', pdfFile);
      if (pdfTitle.trim()) {
        formData.append('title', pdfTitle.trim());
      }

      const res = await fetch('/api/ingest/pdf', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || data.message || 'PDF ingestion failed');
      }

      setPdfFile(null);
      setPdfTitle('');
      if (onStartJob && data.job) {
        onStartJob(data.job);
      }
    } catch (err) {
      setLocalError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const isSubmitDisabled =
    isBusy || (ingestMode === 'youtube' ? !videoUrl.trim() : !pdfFile);

  const pct = Math.max(0, Math.min(100, Number(activeJob?.percent ?? 0)));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl bg-midnight-950 border border-neon-500/80 shadow-emerald-input p-6 relative">
        {/* Always unlocked so user can minimize to background pill at any time */}
        <button
          type="button"
          onClick={onClose}
          title={isRunning ? 'Minimize to background' : 'Close'}
          className="absolute top-4 right-4 text-gray-500 hover:text-gray-200 text-sm transition-colors"
        >
          ✕
        </button>

        <div className="flex items-center gap-2.5 mb-4">
          <span
            className={`w-2.5 h-2.5 rounded-full bg-neon-400 shadow-[0_0_10px_#34d399] ${
              isRunning ? 'animate-pulse' : ''
            }`}
          />
          <h3 className="text-base font-medium text-gray-100">
            {ingestMode === 'youtube'
              ? 'Ingest YouTube Technical Lecture'
              : 'Ingest PDF Research Paper / Slide Deck'}
          </h3>
        </div>

        {/* Mode Toggle Tabs */}
        <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-midnight-900 border border-midnight-700 mb-4">
          <button
            type="button"
            onClick={() => switchMode('youtube')}
            disabled={isBusy}
            className={`py-2 rounded-lg text-xs font-medium transition-all ${
              ingestMode === 'youtube'
                ? 'bg-neon-500/20 text-neon-400 border border-neon-500/60 shadow-emerald-glow'
                : 'text-gray-400 hover:text-gray-200 disabled:opacity-40'
            }`}
          >
            ▶️ YouTube Lecture
          </button>
          <button
            type="button"
            onClick={() => switchMode('pdf')}
            disabled={isBusy}
            className={`py-2 rounded-lg text-xs font-medium transition-all ${
              ingestMode === 'pdf'
                ? 'bg-neon-500/20 text-neon-400 border border-neon-500/60 shadow-emerald-glow'
                : 'text-gray-400 hover:text-gray-200 disabled:opacity-40'
            }`}
          >
            📄 PDF / Slide Deck
          </button>
        </div>

        {!isRunning && (
          <p className="text-xs text-gray-400 leading-relaxed mb-4">
            {ingestMode === 'youtube' ? (
              <>
                Paste a YouTube URL below. OmniRAG will extract timestamped captions
                via <code className="text-neon-400">yt-dlp</code>, build time-windowed
                semantic chunks, and index 3072-dimensional vectors in MongoDB Atlas.
              </>
            ) : (
              <>
                Upload a PDF research paper or lecture slide deck. OmniRAG uses{' '}
                <code className="text-neon-400">Gemini 2.5 Flash</code> vision to
                extract text, equations, and diagrams page-by-page into MongoDB Atlas.
              </>
            )}
          </p>
        )}

        <form onSubmit={handleIngest} className="space-y-4">
          {ingestMode === 'youtube' ? (
            <div>
              <label className="block text-xs font-medium text-gray-300 mb-1.5">
                YouTube Video URL
              </label>
              <input
                type="url"
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                disabled={isBusy}
                placeholder="https://www.youtube.com/watch?v=..."
                required
                className="w-full rounded-xl bg-midnight-900/90 border border-neon-500/80 shadow-emerald-glow px-3.5 py-2.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-neon-400 disabled:opacity-50"
              />
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1.5">
                  Select PDF Document (Max 25 MB)
                </label>
                <input
                  type="file"
                  accept=".pdf,application/pdf"
                  disabled={isBusy}
                  onChange={(e) => setPdfFile(e.target.files?.[0] || null)}
                  required
                  className="w-full rounded-xl bg-midnight-900/90 border border-neon-500/80 shadow-emerald-glow px-3.5 py-2 text-xs text-gray-200 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-neon-500/20 file:text-neon-400 hover:file:bg-neon-500/30 focus:outline-none disabled:opacity-50"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1.5">
                  Custom Document Title (Optional)
                </label>
                <input
                  type="text"
                  value={pdfTitle}
                  onChange={(e) => setPdfTitle(e.target.value)}
                  disabled={isBusy}
                  placeholder="e.g., Attention Is All You Need (Paper)"
                  className="w-full rounded-xl bg-midnight-900/90 border border-midnight-700 px-3.5 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-neon-400 disabled:opacity-50"
                />
              </div>
            </>
          )}

          {/* Live Progress Panel (Running State) */}
          {isRunning && activeJob && (
            <div className="rounded-xl bg-midnight-900/95 border border-neon-500/50 p-3.5 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-gray-100 truncate">
                  {activeJob.title}
                </span>
                {cooldownSec > 0 && (
                  <span className="shrink-0 px-2.5 py-0.5 rounded-full text-[11px] font-mono bg-amber-500/15 border border-amber-400/50 text-amber-300">
                    Quota reset: {cooldownSec}s
                  </span>
                )}
              </div>

              {/* Glowing Emerald Progress Bar */}
              <div className="flex items-center gap-3">
                <div className="flex-1 h-2 rounded-full bg-midnight-800 border border-midnight-700 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-neon-400 to-neon-500 shadow-[0_0_12px_#34d399] transition-all duration-500 ease-out"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-xs font-mono font-semibold text-neon-400 w-9 text-right">
                  {pct}%
                </span>
              </div>

              <div className="flex items-center justify-between text-[11px] font-mono text-gray-400">
                <span className="truncate">{activeJob.message}</span>
                {activeJob.totalBatches > 0 && (
                  <span className="shrink-0 text-gray-500 ml-2">
                    Batch {activeJob.currentBatch || 1}/{activeJob.totalBatches}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Completed Banner */}
          {isCompleted && activeJob && (
            <div className="p-3 rounded-lg bg-neon-500/10 border border-neon-500/40 text-xs text-neon-400 flex items-start justify-between gap-2">
              <span>{activeJob.message}</span>
              {onDismissJob && (
                <button
                  type="button"
                  onClick={onDismissJob}
                  className="text-neon-400/70 hover:text-neon-300 shrink-0"
                >
                  ✕
                </button>
              )}
            </div>
          )}

          {/* Error Banner */}
          {(localError || (isFailed && activeJob?.error)) && (
            <div className="p-3 rounded-lg bg-abstain-bg border border-abstain-border text-xs text-abstain-text">
              {localError || activeJob?.error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className={`px-4 py-2 rounded-xl text-xs transition-all border ${
                isRunning
                  ? 'bg-midnight-900 border-neon-500/50 text-neon-400 hover:bg-neon-500/10'
                  : 'bg-midnight-800 border-midnight-700 text-gray-300 hover:text-gray-100'
              }`}
            >
              {isRunning ? 'Run in Background' : 'Close'}
            </button>
            <button
              type="submit"
              disabled={isSubmitDisabled}
              className="px-5 py-2 rounded-xl font-medium text-xs text-midnight-950 bg-gradient-to-r from-neon-400 to-neon-500 shadow-emerald-btn hover:brightness-110 transition-all disabled:opacity-50"
            >
              {isBusy
                ? 'Ingesting...'
                : ingestMode === 'youtube'
                ? '+ Ingest Video'
                : '+ Ingest PDF'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Floating Bottom-Right Progress Pill (Shown when IngestModal is minimized)
 */
export function IngestProgressPill({ job, isModalOpen, onExpand, onDismiss }) {
  const cooldownSec = useCooldownSeconds(job?.cooldownEndsAt);

  if (!job || isModalOpen) return null;

  const isRunning = job.status === 'running';
  const isCompleted = job.status === 'completed';
  const isFailed = job.status === 'failed';
  const pct = Math.max(0, Math.min(100, Number(job.percent ?? 0)));

  return (
    <div
      onClick={onExpand}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onExpand();
      }}
      className={`fixed bottom-5 right-5 z-40 w-80 rounded-2xl bg-midnight-950/95 backdrop-blur-md p-3.5 cursor-pointer transition-all hover:scale-[1.01] border ${
        isFailed
          ? 'border-abstain-border shadow-lg'
          : 'border-neon-500/80 shadow-emerald-input'
      }`}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${
              isFailed
                ? 'bg-amber-400'
                : 'bg-neon-400 shadow-[0_0_8px_#34d399]'
            } ${isRunning ? 'animate-pulse' : ''}`}
          />
          <span className="text-xs font-medium text-gray-100 truncate">
            {isCompleted
              ? `Indexed: ${job.title}`
              : isFailed
              ? `Failed: ${job.title}`
              : `Indexing: ${job.title}`}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {!isRunning && onDismiss && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDismiss();
              }}
              title="Dismiss"
              className="text-gray-500 hover:text-gray-200 text-xs px-1"
            >
              ✕
            </button>
          )}
          <span
            title="Expand progress modal"
            className="text-neon-400/80 hover:text-neon-300 text-xs font-mono"
          >
            ↗
          </span>
        </div>
      </div>

      {/* Mini Progress Bar */}
      <div className="flex items-center gap-2.5 mb-1.5">
        <div className="flex-1 h-1.5 rounded-full bg-midnight-800 border border-midnight-700 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ease-out ${
              isFailed
                ? 'bg-amber-400'
                : 'bg-gradient-to-r from-neon-400 to-neon-500 shadow-[0_0_10px_#34d399]'
            }`}
            style={{ width: `${isFailed ? 100 : pct}%` }}
          />
        </div>
        <span className="text-[11px] font-mono font-semibold text-neon-400 w-8 text-right">
          {pct}%
        </span>
      </div>

      <div className="flex items-center justify-between text-[11px] font-mono text-gray-400">
        <span className="truncate">
          {isCompleted
            ? `${job.totalChunks} chunks saved`
            : isFailed
            ? job.error || 'Ingestion error'
            : job.totalBatches > 0
            ? `Batch ${job.currentBatch || 1}/${job.totalBatches} · ${job.savedChunks}/${job.totalChunks}`
            : job.message}
        </span>
        {isRunning && cooldownSec > 0 && (
          <span className="shrink-0 text-amber-300 ml-2">⏳ {cooldownSec}s</span>
        )}
      </div>
    </div>
  );
}