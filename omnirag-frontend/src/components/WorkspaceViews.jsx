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
 * History Tab View: 2-View Toggle between Query Audit History & Ingested Corpus
 */
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
                const sessionMatch = messages.find(
                  (m) => m.question === trace.query && m.citations?.length > 0
                );
                const citations =
                  trace.citations?.length > 0
                    ? trace.citations
                    : sessionMatch?.citations || [];
                const citationCount =
                  citations.length || trace.citations_count || 0;

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
                            const isPdfCit = String(cit.video_id || '').startsWith('pdf_');
                            if (isPdfCit) {
                              return (
                                <span
                                  key={`${cit.chunk_id || idx}`}
                                  onClick={(e) => e.stopPropagation()}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono bg-neon-500/10 border border-neon-500/40 text-neon-300"
                                >
                                  <span>📄</span>
                                  <span>
                                    {cit.video_id} @ {cit.timestamp}
                                  </span>
                                </span>
                              );
                            }

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
                                <span>↗️</span>
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

      {/* VIEW 2: Ingested Multi-Modal Corpus // Active Knowledge Base */}
      {activeSubTab === 'corpus' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-300">
              Ingested Video Corpus // Active Knowledge Base
            </h2>
            <span className="text-xs text-gray-400 font-mono">
              {videos.length} Resource(s) Indexed
            </span>
          </div>

          {loadingVideos ? (
            <div className="rounded-xl bg-midnight-800/60 border border-midnight-700 p-6 text-center text-xs text-gray-400 font-mono">
              Scanning MongoDB video_chunks collection...
            </div>
          ) : videos.length === 0 ? (
            <div className="rounded-xl bg-midnight-800/60 border border-midnight-700 p-6 text-center text-xs text-gray-400">
              No videos or PDFs indexed in MongoDB yet. Click &quot;+ Ingest&quot; in
              the top bar to add a YouTube lecture or PDF.
            </div>
          ) : (
            <div className="space-y-3">
              {videos.map((vid) => {
                const isPdf = String(vid.video_id || '').startsWith('pdf_');
                const videoUrl =
                  vid.url || `https://www.youtube.com/watch?v=${vid.video_id}`;

                return (
                  <div
                    key={vid.video_id}
                    className="rounded-xl bg-midnight-800/80 border border-midnight-700/90 hover:border-neon-500/40 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-all"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2.5">
                        {isPdf ? (
                          <span className="px-2 py-0.5 rounded bg-neon-500/10 border border-neon-500/40 text-[11px] font-mono text-neon-300 shrink-0">
                            📄 PDF
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded bg-midnight-900 border border-midnight-700 text-[11px] font-mono text-neon-400 shrink-0">
                            ▶️ YouTube
                          </span>
                        )}
                        <h3 className="text-sm font-medium text-gray-100 truncate">
                          {vid.title ||
                            (isPdf
                              ? `Document ${vid.video_id}`
                              : `Lecture ${vid.video_id}`)}
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

                      {!isPdf && (
                        <a
                          href={videoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-1 rounded-lg text-xs font-mono bg-midnight-900 border border-midnight-700 hover:border-neon-500/60 text-gray-200 hover:text-neon-400 transition-colors"
                        >
                          ↗️ Watch
                        </a>
                      )}

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
                          : isPdf
                          ? '🗑 Remove PDF'
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

const ARCHITECTURE_STAGES = [
  {
    id: 'ingest',
    step: '01',
    shortTitle: 'Multi-Modal Ingestion',
    badge: 'YouTube + PDF Vision',
    files: 'src/ingestion/ytIngest.js · src/ingestion/pdfIngest.js',
    summary:
      'Ingests both YouTube technical lectures and multi-page PDFs/slide decks into a unified, timestamped chunk representation.',
    mechanics:
      'YouTube uses a 3-tier fallback (Direct InnerTube → yt-dlp → Duration-Calibrated Gemini 2.5 Flash) sliced into 80s overlapping windows (18s overlap). PDFs use Gemini 2.5 Flash multi-modal vision to extract text, equations, tables, and diagrams page-by-page inside 22,000-token rate-safe batches.',
    whyItMatters:
      'Eliminates fragile single-source scrapers and prevents Free-Tier 429 TPM rate-limit crashes on large 50+ page slide decks.',
  },
  {
    id: 'storage',
    step: '02',
    shortTitle: 'Tenant-Isolated Vector Store',
    badge: 'MongoDB Atlas · 3072-D',
    files: 'src/config/db.js · src/contracts/schema.js',
    summary:
      'Embeds every chunk into a 3072-dimensional vector using gemini-embedding-001 and enforces strict per-user tenant isolation.',
    mechanics:
      'Documents are validated against a strict contract and stored with a compound unique index on (user_id, chunk_id). Both Atlas $vectorSearch and Atlas BM25 $search indexes filter on user_id at query time.',
    whyItMatters:
      'Two users can independently ingest the same lecture or PDF without collisions, and Account A can never view, query, or delete Account B’s private knowledge base.',
  },
  {
    id: 'retrieval',
    step: '03',
    shortTitle: 'Hybrid Search + RRF Fusion',
    badge: 'Dense Vector + BM25',
    files: 'src/retrieval/hybridSearch.js',
    summary:
      'Executes semantic cosine vector search and exact keyword BM25 search concurrently, merging both ranked lists mathematically.',
    mechanics:
      'Reciprocal Rank Fusion (RRF) computes score(d) = 1/(60 + rank_vector) + 1/(60 + rank_bm25) across user-scoped candidates, with an automatic exact-KNN + lexical fallback if Atlas indexes are still syncing.',
    whyItMatters:
      'Dense embeddings capture conceptual phrasing while BM25 catches exact acronyms, error codes, and algorithm names that pure vector search misses.',
  },
  {
    id: 'gate',
    step: '04',
    shortTitle: 'Cross-Encoder Gate & Compactor',
    badge: 'Threshold ≥ 0.50',
    files: 'src/retrieval/compactor.js',
    summary:
      'Judges every RRF candidate on a strict [0.0, 1.0] relevance scale before generation and compresses spoken filler words.',
    mechanics:
      'A batched Cross-Encoder LLM judge scores query-to-chunk entailment and drops anything below 0.50. Surviving chunks pass through a deterministic regex compactor that strips verbal filler ("um", "you know", "basically") while preserving technical terms.',
    whyItMatters:
      'Solves RRF’s biggest weakness—RRF always returns a Rank #1 chunk even for irrelevant questions. The Cross-Encoder blocks false positives and trims input tokens to lower TTFT.',
  },
  {
    id: 'generation',
    step: '05',
    shortTitle: 'Grounded SSE vs. $0 Abstention',
    badge: 'Branching Output Gate',
    files: 'src/generation/generator.js · src/server.js',
    summary:
      'Routes queries down one of two deterministic paths: zero-cost abstention when 0 chunks survive, or strict schema-enforced JSON streaming.',
    mechanics:
      'If 0 chunks pass the Cross-Encoder, the pipeline short-circuits immediately with is_abstained: true ($0.00 generation cost). Otherwise, Gemini streams structured JSON over Server-Sent Events (SSE) requiring inline <chunk id="..."> citations mapped to exact timestamps or pages.',
    whyItMatters:
      'Guarantees zero-hallucination behavior on out-of-scope questions and gives users clickable proof for every factual claim.',
  },
  {
    id: 'evals',
    step: '06',
    shortTitle: 'Telemetry & CI/CD Eval Gate',
    badge: '100% Pass Threshold',
    files: 'src/middleware/telemetry.js · evals/runEvals.js · .github/workflows/',
    summary:
      'Persists per-request latency, token savings, and USD cost to MongoDB while gating every Git push with an automated LLM-as-a-Judge suite.',
    mechanics:
      'Every stream logs TTFT, total latency, prompt/completion tokens, compaction savings, and USD cost per user. On every push/PR to main, GitHub Actions runs evals/runEvals.js against golden factual and adversarial abstention test cases.',
    whyItMatters:
      'Prevents prompt or retrieval regressions from ever reaching production and makes system cost/latency observable in real time.',
  },
];

/**
 * Animated Vertical Arrow Connector (inside each pipeline lane)
 */
function AnimatedVerticalArrow({ label, active = false }) {
  const strokeColor = active ? '#34d399' : '#10b981';
  const markerId = active ? 'v-arrow-active' : 'v-arrow-dim';

  return (
    <div className="flex flex-col items-center justify-center py-0.5 select-none">
      <svg className="w-7 h-9 overflow-visible" viewBox="0 0 28 36">
        <defs>
          <marker
            id={markerId}
            markerWidth="8"
            markerHeight="8"
            refX="4"
            refY="4"
            orient="auto"
          >
            <path d="M 1 1 L 7 4 L 1 7 z" fill={strokeColor} />
          </marker>
        </defs>
        {/* Glowing Static Track */}
        <line
          x1="14"
          y1="2"
          x2="14"
          y2="29"
          stroke={strokeColor}
          strokeOpacity={active ? '0.35' : '0.18'}
          strokeWidth="2"
        />
        {/* Animated Moving Dashes + Arrowhead */}
        <line
          x1="14"
          y1="2"
          x2="14"
          y2="29"
          stroke={strokeColor}
          strokeWidth={active ? '2.5' : '1.75'}
          strokeDasharray="4 4"
          markerEnd={`url(#${markerId})`}
          className="omnirag-flow-line"
        />
        {/* Traveling Light Packet */}
        <circle r={active ? '3' : '2'} fill="#6ee7b7">
          <animateMotion
            dur={active ? '1.1s' : '2s'}
            repeatCount="indefinite"
            path="M 14 2 L 14 29"
          />
        </circle>
      </svg>
      <span
        className={`text-[11px] font-mono transition-colors ${
          active ? 'text-neon-300 font-medium' : 'text-neon-400/80'
        }`}
      >
        {label}
      </span>
    </div>
  );
}

/**
 * Animated Cross-Lane Arrow Bridge (connects Lane A -> Lane B -> Lane C)
 */
function AnimatedLaneBridge({ label, active = false }) {
  const strokeColor = active ? '#34d399' : '#10b981';
  const markerId = active ? 'h-arrow-active' : 'h-arrow-dim';

  return (
    <div className="flex xl:flex-col items-center justify-center py-1 xl:py-0 xl:px-0.5 select-none">
      {/* Desktop Horizontal Arrow */}
      <div className="hidden xl:flex flex-col items-center gap-1">
        <span
          className={`text-[10px] font-mono text-center leading-tight px-1.5 py-0.5 rounded bg-midnight-950 border transition-colors ${
            active
              ? 'border-neon-400/80 text-neon-300 shadow-emerald-glow'
              : 'border-midnight-800 text-neon-400/75'
          }`}
        >
          {label}
        </span>
        <svg className="w-12 h-8 overflow-visible" viewBox="0 0 48 32">
          <defs>
            <marker
              id={markerId}
              markerWidth="8"
              markerHeight="8"
              refX="5"
              refY="4"
              orient="auto"
            >
              <path d="M 1 1 L 7 4 L 1 7 z" fill={strokeColor} />
            </marker>
          </defs>
          <line
            x1="2"
            y1="16"
            x2="41"
            y2="16"
            stroke={strokeColor}
            strokeOpacity={active ? '0.35' : '0.18'}
            strokeWidth="2"
          />
          <line
            x1="2"
            y1="16"
            x2="41"
            y2="16"
            stroke={strokeColor}
            strokeWidth={active ? '2.5' : '1.75'}
            strokeDasharray="5 4"
            markerEnd={`url(#${markerId})`}
            className="omnirag-flow-line"
          />
          <circle r={active ? '3.2' : '2.2'} fill="#6ee7b7">
            <animateMotion
              dur={active ? '1s' : '1.9s'}
              repeatCount="indefinite"
              path="M 2 16 L 41 16"
            />
          </circle>
        </svg>
      </div>

      {/* Mobile / Tablet Vertical Fallback Arrow */}
      <div className="flex xl:hidden">
        <AnimatedVerticalArrow label={label} active={active} />
      </div>
    </div>
  );
}

/**
 * About Tab View: Interactive Animated System Architecture & Interviewer Walkthrough
 */
export function AboutView() {
  const [selectedId, setSelectedId] = useState('ingest');
  const [isAutoPlaying, setIsAutoPlaying] = useState(true);

  const activeStage =
    ARCHITECTURE_STAGES.find((s) => s.id === selectedId) || ARCHITECTURE_STAGES[0];

  useEffect(() => {
    if (!isAutoPlaying) return undefined;

    const timer = setInterval(() => {
      setSelectedId((prevId) => {
        const idx = ARCHITECTURE_STAGES.findIndex((s) => s.id === prevId);
        const nextIdx = (idx + 1) % ARCHITECTURE_STAGES.length;
        return ARCHITECTURE_STAGES[nextIdx].id;
      });
    }, 2800);

    return () => clearInterval(timer);
  }, [isAutoPlaying]);

  const handleSelectStage = (id) => {
    setIsAutoPlaying(false);
    setSelectedId(id);
  };

  const handleNextStage = () => {
    setIsAutoPlaying(false);
    const idx = ARCHITECTURE_STAGES.findIndex((s) => s.id === selectedId);
    const nextIdx = (idx + 1) % ARCHITECTURE_STAGES.length;
    setSelectedId(ARCHITECTURE_STAGES[nextIdx].id);
  };

  const nodeCardClass = (id) =>
    `text-left rounded-xl p-3.5 border transition-all duration-300 cursor-pointer relative ${
      selectedId === id
        ? 'bg-neon-500/15 border-neon-400 shadow-emerald-glow scale-[1.01]'
        : 'bg-midnight-900/90 border-midnight-700 hover:border-neon-500/50 opacity-85 hover:opacity-100'
    }`;

  return (
    <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
      <style>{`
        @keyframes omniragDashFlow {
          to {
            stroke-dashoffset: -18;
          }
        }
        .omnirag-flow-line {
          animation: omniragDashFlow 0.9s linear infinite;
        }
      `}</style>

      {/* Top Architecture Hero Banner */}
      <div className="rounded-xl bg-midnight-800/80 border border-neon-500/60 shadow-emerald-glow p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1.5">
          <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full text-[11px] font-mono bg-neon-500/15 border border-neon-500/40 text-neon-400">
            <span className="w-1.5 h-1.5 rounded-full bg-neon-400 animate-ping" />
            <span>SYSTEM ARCHITECTURE</span>
            <span>·</span>
            <span>ANIMATED PIPELINE</span>
          </div>
          <h2 className="text-base sm:text-lg font-medium text-gray-100">
            OmniRAG — Observable Multi-Modal Research Assistant
          </h2>
          <p className="text-xs sm:text-sm text-gray-300 leading-relaxed max-w-3xl">
            End-to-end, tenant-isolated Agentic RAG system combining multi-modal ingestion
            (YouTube + PDF Vision), Hybrid Vector + BM25 search with Reciprocal Rank Fusion,
            a Cross-Encoder relevance gate, and an automated CI/CD LLM-as-a-Judge pipeline.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0 self-start lg:self-center">
          <button
            type="button"
            onClick={() => setIsAutoPlaying((prev) => !prev)}
            className={`px-3.5 py-2 rounded-xl border text-xs font-mono font-medium transition-all ${
              isAutoPlaying
                ? 'bg-neon-500/15 border-neon-500/60 text-neon-300'
                : 'bg-midnight-900 border-midnight-700 text-gray-300 hover:border-neon-500/50'
            }`}
          >
            {isAutoPlaying ? '⏸ Pause Flow' : '▶ Auto-Flow'}
          </button>

          <button
            type="button"
            onClick={handleNextStage}
            className="px-4 py-2 rounded-xl bg-neon-500/20 border border-neon-500/70 hover:bg-neon-500/30 text-xs font-mono font-medium text-neon-300 shadow-emerald-glow transition-all"
          >
            Next Step ({activeStage.step}/06) →
          </button>
        </div>
      </div>

      {/* Interactive Animated Architecture Flowchart */}
      <div className="rounded-2xl bg-midnight-950/90 border border-midnight-700/90 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-midnight-800 pb-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-300">
            End-to-End Data & Control Flow Diagram (Click Any Node or Watch Live Flow)
          </span>
          <span className="text-[11px] font-mono text-neon-400">
            Active Node: [{activeStage.step}] {activeStage.shortTitle}
          </span>
        </div>

        {/* 3-Lane Animated Pipeline Canvas with Cross-Lane Arrow Bridges */}
        <div className="flex flex-col xl:flex-row items-stretch justify-between gap-2">
          {/* LANE A: Offline / On-Demand Ingestion & Tenant Storage */}
          <div className="flex-1 rounded-xl bg-midnight-900/50 border border-midnight-800 p-3.5 flex flex-col justify-between gap-1.5">
            <div className="text-[11px] font-mono uppercase tracking-wider text-gray-400 mb-1">
              Lane A · Multi-Modal Ingestion &amp; Store
            </div>

            {/* Node 01 */}
            <button
              type="button"
              onClick={() => handleSelectStage('ingest')}
              className={nodeCardClass('ingest')}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-[11px] font-mono text-neon-400">
                  [01] INGESTION PIPELINE
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-midnight-950 border border-midnight-700 text-gray-300">
                  80s / Page Chunks
                </span>
              </div>
              <div className="text-xs font-semibold text-gray-100">
                YouTube (InnerTube / yt-dlp) + PDF Vision
              </div>
              <p className="text-[11px] text-gray-400 mt-1">
                Extracts transcripts, tables &amp; diagrams via Gemini 2.5 Flash (22k TPM safe batches).
              </p>
            </button>

            {/* Animated Arrow 01 -> 02 */}
            <AnimatedVerticalArrow
              label="3072-Dim Embeddings + JWT user_id"
              active={selectedId === 'ingest' || selectedId === 'storage'}
            />

            {/* Node 02 */}
            <button
              type="button"
              onClick={() => handleSelectStage('storage')}
              className={nodeCardClass('storage')}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-[11px] font-mono text-neon-400">
                  [02] MONGODB ATLAS
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-neon-500/10 border border-neon-500/40 text-neon-300">
                  user_id Isolated
                </span>
              </div>
              <div className="text-xs font-semibold text-gray-100">
                video_chunks + Vector &amp; BM25 Indexes
              </div>
              <p className="text-[11px] text-gray-400 mt-1">
                Compound unique index <code className="text-neon-300">(user_id, chunk_id)</code> isolates every account.
              </p>
            </button>
          </div>

          {/* Animated Bridge: Lane A (02) -> Lane B (03) */}
          <AnimatedLaneBridge
            label="User Query"
            active={selectedId === 'storage' || selectedId === 'retrieval'}
          />

          {/* LANE B: Online Retrieval, Fusion & Relevance Gate */}
          <div className="flex-1 rounded-xl bg-midnight-900/50 border border-midnight-800 p-3.5 flex flex-col justify-between gap-1.5">
            <div className="text-[11px] font-mono uppercase tracking-wider text-gray-400 mb-1">
              Lane B · Online Hybrid Retrieval &amp; Gate
            </div>

            {/* Node 03 */}
            <button
              type="button"
              onClick={() => handleSelectStage('retrieval')}
              className={nodeCardClass('retrieval')}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-[11px] font-mono text-neon-400">
                  [03] HYBRID SEARCH + RRF
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-midnight-950 border border-midnight-700 text-gray-300">
                  k = 60
                </span>
              </div>
              <div className="text-xs font-semibold text-gray-100">
                Parallel Dense Vector + Lexical BM25
              </div>
              <p className="text-[11px] text-gray-400 mt-1">
                Pre-filters by <code className="text-neon-300">user_id</code>, then fuses semantic + keyword ranks via RRF.
              </p>
            </button>

            {/* Animated Arrow 03 -> 04 */}
            <AnimatedVerticalArrow
              label="Top-K Candidate Chunks"
              active={selectedId === 'retrieval' || selectedId === 'gate'}
            />

            {/* Node 04 */}
            <button
              type="button"
              onClick={() => handleSelectStage('gate')}
              className={nodeCardClass('gate')}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-[11px] font-mono text-neon-400">
                  [04] CROSS-ENCODER &amp; COMPACTOR
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-neon-500/10 border border-neon-500/40 text-neon-300">
                  Score ≥ 0.50
                </span>
              </div>
              <div className="text-xs font-semibold text-gray-100">
                Relevance Judge + Spoken-Filler Stripper
              </div>
              <p className="text-[11px] text-gray-400 mt-1">
                Rejects weak matches (&lt; 0.50) and compacts filler tokens to cut TTFT latency.
              </p>
            </button>
          </div>

          {/* Animated Bridge: Lane B (04) -> Lane C (05) */}
          <AnimatedLaneBridge
            label="Gated Context"
            active={selectedId === 'gate' || selectedId === 'generation'}
          />

          {/* LANE C: Branching Output & Continuous Quality Gate */}
          <div className="flex-1 rounded-xl bg-midnight-900/50 border border-midnight-800 p-3.5 flex flex-col justify-between gap-1.5">
            <div className="text-[11px] font-mono uppercase tracking-wider text-gray-400 mb-1">
              Lane C · Grounded Generation &amp; CI/CD
            </div>

            {/* Node 05 */}
            <button
              type="button"
              onClick={() => handleSelectStage('generation')}
              className={nodeCardClass('generation')}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-[11px] font-mono text-neon-400">
                  [05] BRANCHING SYNTHESIS
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-midnight-950 border border-midnight-700 text-gray-300">
                  SSE JSON
                </span>
              </div>
              <div className="text-xs font-semibold text-gray-100">
                Inline Citations vs. $0 Abstention
              </div>
              <div className="grid grid-cols-2 gap-1.5 mt-2 text-[10px] font-mono">
                <div className="px-2 py-1 rounded bg-neon-500/10 border border-neon-500/40 text-neon-300">
                  ≥1 Chunk ➔ &lt;chunk id&gt;
                </div>
                <div className="px-2 py-1 rounded bg-abstain-bg border border-abstain-border text-abstain-text">
                  0 Chunks ➔ $0 Abstain
                </div>
              </div>
            </button>

            {/* Animated Arrow 05 -> 06 */}
            <AnimatedVerticalArrow
              label="Telemetry Traces & Golden Evals"
              active={selectedId === 'generation' || selectedId === 'evals'}
            />

            {/* Node 06 */}
            <button
              type="button"
              onClick={() => handleSelectStage('evals')}
              className={nodeCardClass('evals')}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-[11px] font-mono text-neon-400">
                  [06] OBSERVABILITY &amp; CI/CD
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-neon-500/10 border border-neon-500/40 text-neon-300">
                  100% Gate
                </span>
              </div>
              <div className="text-xs font-semibold text-gray-100">
                Live TTFT/Cost Sidebar + GitHub Actions
              </div>
              <p className="text-[11px] text-gray-400 mt-1">
                Logs TTFT, tokens &amp; USD cost; blocks merges if LLM-as-a-Judge evals drop below 100%.
              </p>
            </button>
          </div>
        </div>
      </div>

      {/* Selected Node Deep-Dive Inspector */}
      <div className="rounded-xl bg-midnight-800/90 border border-neon-500/60 shadow-emerald-glow p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-midnight-700 pb-2.5">
          <div className="flex items-center gap-2.5">
            <span className="px-2.5 py-0.5 rounded-md text-xs font-mono font-semibold bg-neon-500/20 border border-neon-500/50 text-neon-300">
              STAGE {activeStage.step}
            </span>
            <h3 className="text-sm sm:text-base font-semibold text-gray-100">
              {activeStage.shortTitle}
            </h3>
            <span className="px-2 py-0.5 rounded-full text-[11px] font-mono bg-midnight-950 border border-midnight-700 text-neon-400">
              {activeStage.badge}
            </span>
          </div>
          <span className="text-xs font-mono text-gray-400">
            {activeStage.files}
          </span>
        </div>

        <p className="text-xs sm:text-sm text-gray-200 leading-relaxed">
          {activeStage.summary}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
          <div className="rounded-lg bg-midnight-950/90 border border-midnight-700/90 p-3.5 space-y-1">
            <div className="text-[11px] font-mono uppercase tracking-wider text-neon-400">
              How It Works Under the Hood
            </div>
            <p className="text-xs text-gray-300 leading-relaxed">
              {activeStage.mechanics}
            </p>
          </div>

          <div className="rounded-lg bg-midnight-950/90 border border-midnight-700/90 p-3.5 space-y-1">
            <div className="text-[11px] font-mono uppercase tracking-wider text-neon-400">
              Engineering Trade-Off &amp; Interview Signal
            </div>
            <p className="text-xs text-gray-300 leading-relaxed">
              {activeStage.whyItMatters}
            </p>
          </div>
        </div>
      </div>

      {/* Bottom 3-Column Interview Talking Points */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
        <div className="rounded-xl bg-midnight-800/80 border border-midnight-700/90 p-4 space-y-1.5">
          <h4 className="text-xs font-semibold text-neon-400 uppercase tracking-wide">
            Why Hybrid RRF + Cross-Encoder?
          </h4>
          <p className="text-xs text-gray-400 leading-relaxed">
            RRF merges dense semantic similarity with exact BM25 keyword matches, while
            the Cross-Encoder acts as a calibrated relevance firewall—rejecting out-of-scope
            queries that still rank #1 in vector similarity.
          </p>
        </div>

        <div className="rounded-xl bg-midnight-800/80 border border-midnight-700/90 p-4 space-y-1.5">
          <h4 className="text-xs font-semibold text-neon-400 uppercase tracking-wide">
            Multi-Tenant Data Isolation
          </h4>
          <p className="text-xs text-gray-400 leading-relaxed">
            Every chunk, telemetry trace, and Atlas Search query is scoped to the JWT
            authenticated <code className="text-gray-200">user_id</code> with compound{' '}
            <code className="text-gray-200">(user_id, chunk_id)</code> uniqueness, preventing
            cross-account data leakage or collisions.
          </p>
        </div>

        <div className="rounded-xl bg-midnight-800/80 border border-midnight-700/90 p-4 space-y-1.5">
          <h4 className="text-xs font-semibold text-neon-400 uppercase tracking-wide">
            Production Resilience &amp; Evals
          </h4>
          <p className="text-xs text-gray-400 leading-relaxed">
            Token-budgeted PDF batching (≤ 22k tokens/request), 3-tier YouTube extraction,
            and an automated GitHub Actions LLM-as-a-Judge gate ensure reliable ingestion and
            zero-regression deployments.
          </p>
        </div>
      </div>
    </div>
  );
}