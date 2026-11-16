// File: omnirag-frontend/src/components/WorkspaceViews.jsx
import React, { useState, useEffect, useCallback } from 'react';

/**
 * Converts "mm:ss" or "hh:mm:ss" into total seconds for YouTube ?t= links
 */
function timestampToSeconds(ts = '') {
  const parts = String(ts).split(':').map(Number);
  if (parts.some(Number.isNaN)) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

/**
 * History Tab View: 2-View Toggle between Query Audit History & Ingested Video Corpus
 */
// export function HistoryView({ telemetry, messages = [], onSelectQuery }) {
export function HistoryView({ telemetry, messages = [], onLoadTrace, onRerunQuery }) {
  const [activeSubTab, setActiveSubTab] = useState('queries'); // 'queries' | 'corpus'
  const [videos, setVideos] = useState([]);
  const [loadingVideos, setLoadingVideos] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const recentTraces = telemetry?.recent_traces || [];

  const fetchCorpus = useCallback(async () => {
    setLoadingVideos(true);
    try {
      const token = localStorage.getItem('omnirag_token') || '';
      const res = await fetch('/api/resources', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setVideos(data.videos || []);
      }
    } catch {
      // Keep existing state if backend is unreachable
    } finally {
      setLoadingVideos(false);
    }
  }, []);

  useEffect(() => {
    fetchCorpus();

    window.addEventListener('omnirag:refresh-corpus', fetchCorpus);
    return () => {
      window.removeEventListener('omnirag:refresh-corpus', fetchCorpus);
    };
  }, [fetchCorpus]);

  const handleDeleteVideo = async (videoId, title) => {
    if (!window.confirm(`Remove "${title || videoId}" from MongoDB corpus?`)) {
      return;
    }
    setDeletingId(videoId);
    try {
      const token = localStorage.getItem('omnirag_token') || '';
      const res = await fetch(`/api/resources/${encodeURIComponent(videoId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setVideos((prev) => prev.filter((v) => v.video_id !== videoId));
      }
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
      {/* Side-by-Side Capsule Sub-Tab Toggle Buttons */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pb-1">
        <button
          type="button"
          onClick={() => setActiveSubTab('queries')}
          className={`relative py-2.5 px-4 rounded-full text-xs sm:text-sm font-medium transition-all border ${
            activeSubTab === 'queries'
              ? 'bg-neon-500/15 border-neon-500 text-neon-400 shadow-emerald-glow'
              : 'bg-midnight-800/70 border-midnight-700 text-gray-400 hover:text-gray-200 hover:border-midnight-600'
          }`}
        >
          Recent Query & Telemetry History
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('corpus')}
          className={`relative py-2.5 px-4 rounded-full text-xs sm:text-sm font-medium transition-all border ${
            activeSubTab === 'corpus'
              ? 'bg-neon-500/15 border-neon-500 text-neon-400 shadow-emerald-glow'
              : 'bg-midnight-800/70 border-midnight-700 text-gray-400 hover:text-gray-200 hover:border-midnight-600'
          }`}
        >
          Ingested Video Corpus // Active Knowledge Base
        </button>
      </div>

      {/* VIEW 1: Recent Query & Telemetry History */}
      {activeSubTab === 'queries' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-300">
              Recent Query & Telemetry History
            </h2>
            <span className="text-xs text-gray-400 font-mono">
              Total Logged Requests: {telemetry?.total_requests ?? messages.length}
            </span>
          </div>

          {recentTraces.length === 0 ? (
            <div className="rounded-xl bg-midnight-800/60 border border-midnight-700 p-6 text-center text-xs text-gray-400">
              No persisted telemetry traces found yet. Ask a question in the Chat tab
              to populate history.
            </div>
          ) : (
            <div className="space-y-3">
              {recentTraces.map((trace) => {
                // Use persisted citations on trace, or match from current session messages
                const sessionMatch = messages.find(
                  (m) => m.question === trace.query && m.citations?.length > 0
                );
                const citations =
                  trace.citations?.length > 0
                    ? trace.citations
                    : sessionMatch?.citations || [];
                const citationCount =
                  citations.length || trace.citations_count || 0;

                // return (
                //   <div
                //     key={trace.request_id}
                //     className="rounded-xl bg-midnight-800/80 border border-midnight-700/90 hover:border-neon-500/50 p-4 transition-all space-y-2.5"
                //   >
                //     {/* Top Row: Question + Status Badges + Re-run Button */}
                //     <div className="flex items-center justify-between gap-2">
                //       <span className="text-sm font-medium text-gray-100 truncate">
                //         {trace.query}
                //       </span>

                //       <div className="flex items-center gap-2 shrink-0">
                //         {!trace.is_abstained && (
                //           <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium border bg-neon-500/15 border-neon-500/40 text-neon-400">
                //             GROUNDED
                //           </span>
                //         )}

                //         <span
                //           className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium border ${
                //             trace.is_abstained
                //               ? 'bg-abstain-bg border-abstain-border text-abstain-text'
                //               : 'bg-neon-500/10 border-neon-500/30 text-neon-400'
                //           }`}
                //         >
                //           {trace.is_abstained
                //             ? 'Abstained'
                //             : `${citationCount} Citation(s)`}
                //         </span>

                //         <button
                //           type="button"
                //           onClick={() =>
                //             onSelectQuery && onSelectQuery(trace.query)
                //           }
                //           className="px-2.5 py-0.5 rounded-lg text-[11px] font-mono bg-midnight-900 border border-midnight-700 hover:border-neon-500/60 text-gray-300 hover:text-neon-400 transition-colors"
                //         >
                //           ↻ Re-run
                //         </button>
                //       </div>
                //     </div>

                //     {/* Middle Row: Clickable Timestamp Citation Pills or Abstention Note */}
                //     {trace.is_abstained ? (
                //       <div className="text-xs text-gray-400">
                //         System Abstained: Search parameters unmet.
                //       </div>
                //     ) : (
                //       citations.length > 0 && (
                //         <div className="flex flex-wrap items-center gap-2 pt-0.5">
                //           {citations.map((cit, idx) => {
                //             const sec = timestampToSeconds(cit.timestamp);
                //             const ytUrl = `https://www.youtube.com/watch?v=${cit.video_id}&t=${sec}s`;
                //             return (
                //               <a
                //                 key={`${cit.chunk_id || idx}`}
                //                 href={ytUrl}
                //                 target="_blank"
                //                 rel="noopener noreferrer"
                //                 className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono bg-neon-500/10 border border-neon-500/40 text-neon-400 hover:bg-neon-500/20 transition-colors"
                //               >
                //                 <span>
                //                   {cit.video_id} @ {cit.timestamp}
                //                 </span>
                //                 <span>↗</span>
                //               </a>
                //             );
                //           })}
                //         </div>
                //       )
                //     )}

                //     {/* Bottom Row: Per-Query Telemetry Metrics */}
                //     <div className="flex flex-wrap items-center gap-4 text-xs text-gray-400 font-mono pt-0.5">
                //       <span>Model: {trace.model}</span>
                //       <span>TTFT: {trace.latency_ms?.ttft ?? 0} ms</span>
                //       <span>Total: {trace.latency_ms?.total ?? 0} ms</span>
                //       <span>Tokens: {trace.tokens?.total ?? 0}</span>
                //       <span>
                //         Cost: ${Number(trace.estimated_cost_usd || 0).toFixed(6)}
                //       </span>
                //     </div>
                //   </div>
                // );
              return (
                  <div
                    key={trace.request_id}
                    onClick={() => onLoadTrace && onLoadTrace({ ...trace, citations })}
                    className="rounded-xl bg-midnight-800/80 border border-midnight-700/90 hover:border-neon-500/50 p-4 transition-all space-y-2.5 cursor-pointer"
                  >
                    {/* Top Row: Question + Status Badges + Re-run Button */}
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-gray-100 truncate">
                        {trace.query}
                      </span>

                      <div className="flex items-center gap-2 shrink-0">
                        {!trace.is_abstained && (
                          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium border bg-neon-500/15 border-neon-500/40 text-neon-400">
                            GROUNDED
                          </span>
                        )}

                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium border ${
                            trace.is_abstained
                              ? 'bg-abstain-bg border-abstain-border text-abstain-text'
                              : 'bg-neon-500/10 border-neon-500/30 text-neon-400'
                          }`}
                        >
                          {trace.is_abstained
                            ? 'Abstained'
                            : `${citationCount} Citation(s)`}
                        </span>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onRerunQuery && onRerunQuery(trace.query);
                          }}
                          className="px-2.5 py-0.5 rounded-lg text-[11px] font-mono bg-midnight-900 border border-midnight-700 hover:border-neon-500/60 text-gray-300 hover:text-neon-400 transition-colors"
                        >
                          ↻ Re-run
                        </button>
                      </div>
                    </div>

                    {/* Middle Row: Clickable Timestamp Citation Pills or Abstention Note */}
                    {trace.is_abstained ? (
                      <div className="text-xs text-gray-400">
                        System Abstained: Search parameters unmet.
                      </div>
                    ) : (
                      citations.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2 pt-0.5">
                          {citations.map((cit, idx) => {
                            const sec = timestampToSeconds(cit.timestamp);
                            const ytUrl = `https://www.youtube.com/watch?v=${cit.video_id}&t=${sec}s`;
                            return (
                              <a
                                key={`${cit.chunk_id || idx}`}
                                href={ytUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono bg-neon-500/10 border border-neon-500/40 text-neon-400 hover:bg-neon-500/20 transition-colors"
                              >
                                <span>
                                  {cit.video_id} @ {cit.timestamp}
                                </span>
                                <span>↗</span>
                              </a>
                            );
                          })}
                        </div>
                      )
                    )}

                    {/* Bottom Row: Per-Query Telemetry Metrics */}
                    <div className="flex flex-wrap items-center gap-4 text-xs text-gray-400 font-mono pt-0.5">
                      <span>Model: {trace.model}</span>
                      <span>TTFT: {trace.latency_ms?.ttft ?? 0} ms</span>
                      <span>Total: {trace.latency_ms?.total ?? 0} ms</span>
                      <span>Tokens: {trace.tokens?.total ?? 0}</span>
                      <span>
                        Cost: ${Number(trace.estimated_cost_usd || 0).toFixed(6)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* VIEW 2: Ingested Video Corpus // Active Knowledge Base */}
      {activeSubTab === 'corpus' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-300">
              Ingested Video Corpus // Active Knowledge Base
            </h2>
            <span className="text-xs text-gray-400 font-mono">
              {videos.length} Video(s) Indexed
            </span>
          </div>

          {loadingVideos ? (
            <div className="rounded-xl bg-midnight-800/60 border border-midnight-700 p-6 text-center text-xs text-gray-400 font-mono">
              Scanning MongoDB video_chunks collection...
            </div>
          ) : videos.length === 0 ? (
            <div className="rounded-xl bg-midnight-800/60 border border-midnight-700 p-6 text-center text-xs text-gray-400">
              No videos indexed in MongoDB yet. Click &quot;+ Ingest&quot; in the top
              bar to add a YouTube lecture.
            </div>
          ) : (
            <div className="space-y-3">
              {videos.map((vid) => {
                const videoUrl =
                  vid.url || `https://www.youtube.com/watch?v=${vid.video_id}`;
                return (
                  <div
                    key={vid.video_id}
                    className="rounded-xl bg-midnight-800/80 border border-midnight-700/90 hover:border-neon-500/40 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-all"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2.5">
                        <span className="px-2 py-0.5 rounded bg-midnight-900 border border-midnight-700 text-[11px] font-mono text-neon-400">
                          ▶ YouTube
                        </span>
                        <h3 className="text-sm font-medium text-gray-100 truncate">
                          {vid.title || `Lecture ${vid.video_id}`}
                        </h3>
                      </div>
                      <div className="text-xs text-gray-400 font-mono">
                        ID: {vid.video_id}
                      </div>
                    </div>

                    <div className="flex items-center gap-2.5 shrink-0">
                      <span className="px-2.5 py-1 rounded-full text-[11px] font-mono bg-neon-500/15 border border-neon-500/40 text-neon-400">
                        {vid.chunk_count} chunks
                      </span>

                      <a
                        href={videoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-1 rounded-lg text-xs font-mono bg-midnight-900 border border-midnight-700 hover:border-neon-500/60 text-gray-200 hover:text-neon-400 transition-colors"
                      >
                        ↗ Watch
                      </a>

                      <button
                        type="button"
                        disabled={deletingId === vid.video_id}
                        onClick={() =>
                          handleDeleteVideo(vid.video_id, vid.title)
                        }
                        className="px-3 py-1 rounded-lg text-xs font-mono bg-abstain-bg border border-abstain-border text-abstain-text hover:opacity-90 transition-opacity disabled:opacity-50"
                      >
                        {deletingId === vid.video_id
                          ? 'Removing...'
                          : '🗑 Remove Video'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * About Tab View: Architecture & FAANG Signal Overview
 */
export function AboutView() {
  const pillars = [
    {
      title: '1. Time-Windowed yt-dlp Ingestion',
      desc: 'Extracts raw YouTube transcripts and segments them into overlapping time-bounded windows with 3072-dimensional embeddings stored in MongoDB Atlas.',
    },
    {
      title: '2. Hybrid Retrieval (BM25 + Vector + RRF)',
      desc: 'Executes lexical BM25 and dense vector searches concurrently, merging candidate rankings via Reciprocal Rank Fusion (RRF).',
    },
    {
      title: '3. Cross-Encoder Gate & Context Compaction',
      desc: 'Scores candidate chunks on a 0.0–1.0 relevance scale (rejecting anything below 0.50) and strips spoken filler words to reduce TTFT.',
    },
    {
      title: '4. Deterministic Abstention & Inline Citations',
      desc: 'Streams strict JSON responses via Server-Sent Events (SSE) with verifiable <chunk id="vid_..._mm:ss"> timestamps and zero-cost abstention.',
    },
  ];

  return (
    <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
      <div className="rounded-xl bg-midnight-800/80 border border-neon-500/60 shadow-emerald-glow p-5">
        <h2 className="text-base font-medium text-neon-400 mb-1.5">
          OmniRAG — Observable Multi-Modal Research Assistant
        </h2>
        <p className="text-xs sm:text-sm text-gray-300 leading-relaxed">
          A production-grade, hallucination-resistant Agentic RAG pipeline
          engineered for mathematical retrieval precision, strict citation
          grounding, and real-time latency/cost observability.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        {pillars.map((item, idx) => (
          <div
            key={idx}
            className="rounded-xl bg-midnight-800/80 border border-midnight-700/90 p-4 space-y-1.5"
          >
            <h3 className="text-xs font-semibold text-gray-100 uppercase tracking-wide">
              {item.title}
            </h3>
            <p className="text-xs text-gray-400 leading-relaxed">{item.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}