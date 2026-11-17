// File: omnirag-frontend/src/components/Modals.jsx
import React, { useState } from 'react';

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
 * Supports both YouTube Technical Lectures and PDF / Slide Decks (User-Scoped).
 */
export function IngestModal({ isOpen, onClose, onIngestSuccess }) {
  const [ingestMode, setIngestMode] = useState('youtube'); // 'youtube' | 'pdf'
  const [videoUrl, setVideoUrl] = useState('');
  const [pdfFile, setPdfFile] = useState(null);
  const [pdfTitle, setPdfTitle] = useState('');
  const [isIngesting, setIsIngesting] = useState(false);
  const [statusMsg, setStatusMsg] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);

  if (!isOpen) return null;

  const switchMode = (mode) => {
    if (isIngesting) return;
    setIngestMode(mode);
    setStatusMsg(null);
    setErrorMsg(null);
  };

  const handleIngest = async (e) => {
    e.preventDefault();
    if (isIngesting) return;

    const token = localStorage.getItem('omnirag_token') || '';

    if (ingestMode === 'youtube') {
      const trimmed = videoUrl.trim();
      if (!trimmed) return;

      setIsIngesting(true);
      setStatusMsg('Extracting transcript & generating embeddings...');
      setErrorMsg(null);

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

        setStatusMsg(
          `Success! Ingested "${data.title || 'YouTube Lecture'}" (${
            data.chunksCount ?? 'all'
          } time-bounded chunks).`
        );
        setVideoUrl('');
        if (onIngestSuccess) onIngestSuccess(data);
        window.dispatchEvent(new Event('omnirag:refresh-corpus'));
      } catch (err) {
        setErrorMsg(err.message);
        setStatusMsg(null);
      } finally {
        setIsIngesting(false);
      }
      return;
    }

    // PDF / Slide-Deck Mode
    if (!pdfFile) return;

    setIsIngesting(true);
    setStatusMsg(
      'Extracting PDF text, equations & visual diagrams via Gemini 2.5 Flash...'
    );
    setErrorMsg(null);

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

      setStatusMsg(
        `Success! Ingested "${data.title || pdfFile.name}" (${
          data.chunksCount ?? data.chunks_count ?? 'all'
        } page-bounded chunks).`
      );
      setPdfFile(null);
      setPdfTitle('');
      if (onIngestSuccess) onIngestSuccess(data);
      window.dispatchEvent(new Event('omnirag:refresh-corpus'));
    } catch (err) {
      setErrorMsg(err.message);
      setStatusMsg(null);
    } finally {
      setIsIngesting(false);
    }
  };

  const isSubmitDisabled =
    isIngesting ||
    (ingestMode === 'youtube' ? !videoUrl.trim() : !pdfFile);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl bg-midnight-950 border border-neon-500/80 shadow-emerald-input p-6 relative">
        <button
          type="button"
          onClick={onClose}
          disabled={isIngesting}
          className="absolute top-4 right-4 text-gray-500 hover:text-gray-300 text-sm disabled:opacity-40"
        >
          ✕
        </button>

        <div className="flex items-center gap-2.5 mb-4">
          <span className="w-2.5 h-2.5 rounded-full bg-neon-400 shadow-[0_0_10px_#34d399]" />
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
            disabled={isIngesting}
            className={`py-2 rounded-lg text-xs font-medium transition-all ${
              ingestMode === 'youtube'
                ? 'bg-neon-500/20 text-neon-400 border border-neon-500/60 shadow-emerald-glow'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            ▶️ YouTube Lecture
          </button>
          <button
            type="button"
            onClick={() => switchMode('pdf')}
            disabled={isIngesting}
            className={`py-2 rounded-lg text-xs font-medium transition-all ${
              ingestMode === 'pdf'
                ? 'bg-neon-500/20 text-neon-400 border border-neon-500/60 shadow-emerald-glow'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            📄 PDF / Slide Deck
          </button>
        </div>

        {ingestMode === 'youtube' ? (
          <p className="text-xs text-gray-400 leading-relaxed mb-4">
            Paste a YouTube URL below. OmniRAG will extract timestamped captions
            via <code className="text-neon-400">yt-dlp</code>, build time-windowed
            semantic chunks, and index 3072-dimensional vectors in MongoDB Atlas.
          </p>
        ) : (
          <p className="text-xs text-gray-400 leading-relaxed mb-4">
            Upload a PDF research paper or lecture slide deck. OmniRAG uses{' '}
            <code className="text-neon-400">Gemini 2.5 Flash</code> vision to
            extract text, equations, and diagrams page-by-page into MongoDB Atlas.
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
                disabled={isIngesting}
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
                  disabled={isIngesting}
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
                  disabled={isIngesting}
                  placeholder="e.g., Attention Is All You Need (Paper)"
                  className="w-full rounded-xl bg-midnight-900/90 border border-midnight-700 px-3.5 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-neon-400 disabled:opacity-50"
                />
              </div>
            </>
          )}

          {statusMsg && (
            <div className="p-3 rounded-lg bg-neon-500/10 border border-neon-500/40 text-xs text-neon-400">
              {statusMsg}
            </div>
          )}

          {errorMsg && (
            <div className="p-3 rounded-lg bg-abstain-bg border border-abstain-border text-xs text-abstain-text">
              {errorMsg}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={isIngesting}
              className="px-4 py-2 rounded-xl bg-midnight-800 border border-midnight-700 text-xs text-gray-300 hover:text-gray-100"
            >
              Close
            </button>
            <button
              type="submit"
              disabled={isSubmitDisabled}
              className="px-5 py-2 rounded-xl font-medium text-xs text-midnight-950 bg-gradient-to-r from-neon-400 to-neon-500 shadow-emerald-btn hover:brightness-110 transition-all disabled:opacity-50"
            >
              {isIngesting
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