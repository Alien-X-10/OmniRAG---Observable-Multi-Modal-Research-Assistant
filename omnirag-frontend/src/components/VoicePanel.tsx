// File: omnirag-frontend/src/components/VoicePanel.tsx
import React, { useState } from 'react';
import { useVoiceSession, VoicePreset } from '../hooks/useVoiceSession';

const VOICES: VoicePreset[] = ['Kore', 'Charon', 'Fenrir', 'Puck', 'Aoede'];

function timestampToSeconds(ts = ''): number {
  const parts = String(ts).split(':').map(Number);
  if (parts.some(Number.isNaN)) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

export default function VoicePanel() {
  const {
    status,
    voiceName,
    setVoiceName,
    isMuted,
    playbackEpoch,
    activeTurnId,
    bargeInCount,
    droppedStalePackets,
    transcripts,
    citations,
    error,
    startSession,
    endSession,
    toggleMute,
    forceBargeIn,
    sendTextTurn,
  } = useVoiceSession();

  const [textDraft, setTextDraft] = useState('');
  const isLive = status !== 'OFFLINE';

  const statusBadgeStyle =
    status === 'SPEAKING'
      ? 'bg-neon-500/20 border-neon-400 text-neon-400 shadow-emerald-glow animate-pulse'
      : status === 'LISTENING'
      ? 'bg-sky-500/15 border-sky-400/70 text-sky-300'
      : 'bg-midnight-800 border-midnight-700 text-gray-400';

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!textDraft.trim()) return;
    sendTextTurn(textDraft);
    setTextDraft('');
  };

  return (
    <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
      {/* Control Header & Live Status */}
      <div className="rounded-2xl bg-midnight-900/90 border border-midnight-700 p-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono border ${statusBadgeStyle}`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                status === 'SPEAKING'
                  ? 'bg-neon-400'
                  : status === 'LISTENING'
                  ? 'bg-sky-400 animate-ping'
                  : 'bg-gray-500'
              }`}
            />
            {status}
          </span>
          <div>
            <h2 className="text-sm font-semibold text-gray-100">
              OmniRAG Native Voice (Gemini 3.8 Live)
            </h2>
            <p className="text-[11px] font-mono text-gray-400">
              16 kHz PCM In · 24 kHz PCM Out · Two-Flag Barge-In Fence
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={voiceName}
            disabled={isLive}
            onChange={(e) => setVoiceName(e.target.value as VoicePreset)}
            className="px-3 py-1.5 rounded-lg text-xs font-mono bg-midnight-800 border border-midnight-700 text-gray-200 disabled:opacity-50"
          >
            {VOICES.map((v) => (
              <option key={v} value={v}>
                Voice: {v}
              </option>
            ))}
          </select>

          {!isLive ? (
            <button
              type="button"
              onClick={startSession}
              className="px-4 py-1.5 rounded-lg text-xs font-mono font-semibold bg-neon-500/20 border border-neon-500 text-neon-400 hover:bg-neon-500/30 shadow-emerald-glow transition-all"
            >
              🎙 Start Voice Session
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={toggleMute}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono border transition-all ${
                  isMuted
                    ? 'bg-amber-500/20 border-amber-400 text-amber-300'
                    : 'bg-midnight-800 border-midnight-700 text-gray-200 hover:border-neon-500/60'
                }`}
              >
                {isMuted ? '🔇 Unmute Mic' : '🎤 Mute Mic'}
              </button>

              <button
                type="button"
                onClick={forceBargeIn}
                className="px-3 py-1.5 rounded-lg text-xs font-mono bg-rose-500/15 border border-rose-500/70 text-rose-300 hover:bg-rose-500/25 transition-all"
              >
                ⚡ Force Barge-In
              </button>

              <button
                type="button"
                onClick={endSession}
                className="px-3 py-1.5 rounded-lg text-xs font-mono bg-midnight-800 border border-midnight-700 text-gray-300 hover:text-white transition-all"
              >
                ⏹ End Session
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-xl bg-rose-500/10 border border-rose-500/50 px-4 py-2.5 text-xs font-mono text-rose-300">
          {error}
        </div>
      )}

      {/* Live Two-Flag Interruption Counters */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl bg-midnight-900/80 border border-midnight-700 p-3">
          <div className="text-[10px] font-mono uppercase text-gray-400">
            Flag 1 · playback_epoch
          </div>
          <div className="text-lg font-mono font-bold text-neon-400 mt-0.5">
            {playbackEpoch}
          </div>
        </div>

        <div className="rounded-xl bg-midnight-900/80 border border-midnight-700 p-3">
          <div className="text-[10px] font-mono uppercase text-gray-400">
            Flag 2 · active_turn_id
          </div>
          <div className="text-lg font-mono font-bold text-sky-400 mt-0.5">
            {activeTurnId}
          </div>
        </div>

        <div className="rounded-xl bg-midnight-900/80 border border-midnight-700 p-3">
          <div className="text-[10px] font-mono uppercase text-gray-400">
            Barge-In Count
          </div>
          <div className="text-lg font-mono font-bold text-amber-300 mt-0.5">
            {bargeInCount}
          </div>
        </div>

        <div className="rounded-xl bg-midnight-900/80 border border-midnight-700 p-3">
          <div className="text-[10px] font-mono uppercase text-gray-400">
            Dropped Stale Audio Packets
          </div>
          <div className="text-lg font-mono font-bold text-rose-300 mt-0.5">
            {droppedStalePackets}
          </div>
        </div>
      </div>

      {/* Main Split: Live Transcript + Real-Time Grounded Citations */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-2xl bg-midnight-900/80 border border-midnight-700 p-4 flex flex-col min-h-[340px]">
          <div className="text-xs font-mono text-gray-400 pb-2 border-b border-midnight-800">
            Live Audio Transcript Feed
          </div>

          <div className="flex-1 overflow-y-auto py-3 space-y-2.5 max-h-[360px]">
            {transcripts.length === 0 ? (
              <p className="text-xs font-mono text-gray-500">
                Start a voice session and ask about your indexed YouTube lectures or PDF slides.
              </p>
            ) : (
              transcripts.map((entry) => (
                <div
                  key={entry.id}
                  className={`rounded-xl px-3 py-2 text-xs border ${
                    entry.role === 'user'
                      ? 'bg-sky-500/10 border-sky-500/30 text-sky-100'
                      : entry.role === 'agent'
                      ? 'bg-neon-500/10 border-neon-500/30 text-gray-100'
                      : 'bg-midnight-800/70 border-midnight-700 text-gray-400 font-mono'
                  }`}
                >
                  <div className="flex items-center justify-between text-[10px] font-mono opacity-75 mb-1">
                    <span className="uppercase">{entry.role}</span>
                    <span>
                      turn #{entry.turnId} · {entry.timestamp}
                    </span>
                  </div>
                  <p className="leading-relaxed">{entry.text}</p>
                </div>
              ))
            )}
          </div>

          {/* Optional text injection into the live voice session */}
          <form onSubmit={handleTextSubmit} className="pt-2 border-t border-midnight-800 flex gap-2">
            <input
              type="text"
              disabled={!isLive}
              value={textDraft}
              onChange={(e) => setTextDraft(e.target.value)}
              placeholder={
                isLive
                  ? 'Send a text prompt into the active voice session...'
                  : 'Start session to speak or send text...'
              }
              className="flex-1 px-3 py-1.5 rounded-lg text-xs bg-midnight-950 border border-midnight-700 text-gray-200 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!isLive || !textDraft.trim()}
              className="px-3 py-1.5 rounded-lg text-xs font-mono bg-neon-500/20 border border-neon-500/60 text-neon-400 disabled:opacity-40"
            >
              Send
            </button>
          </form>
        </div>

        {/* Real-Time RAG Citations Panel */}
        <div className="rounded-2xl bg-midnight-900/80 border border-midnight-700 p-4 flex flex-col min-h-[340px]">
          <div className="text-xs font-mono text-gray-400 pb-2 border-b border-midnight-800 flex items-center justify-between">
            <span>Live Cited RAG Chunks</span>
            <span className="text-neon-400">{citations.length}</span>
          </div>

          <div className="flex-1 overflow-y-auto py-3 space-y-2.5 max-h-[400px]">
            {citations.length === 0 ? (
              <p className="text-xs font-mono text-gray-500">
                Retrieved citations from MongoDB Hybrid RRF + Cross-Encoder will stream here live while the agent speaks.
              </p>
            ) : (
              citations.map((c) => {
                const isYouTube = c.url?.includes('youtube.com');
                const href = isYouTube
                  ? `${c.url}&t=${timestampToSeconds(c.timestamp)}s`
                  : c.url;

                return (
                  <div
                    key={c.chunk_id}
                    className="rounded-xl bg-midnight-950/90 border border-midnight-700 hover:border-neon-500/60 p-3 space-y-1.5 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-neon-500/15 text-neon-400 border border-neon-500/40">
                        {c.chunk_id}
                      </span>
                      <span className="text-[10px] font-mono text-gray-400">
                        CE {Number(c.score || 0).toFixed(2)}
                      </span>
                    </div>
                    <div className="text-xs font-medium text-gray-200 line-clamp-2">
                      {c.title}
                    </div>
                    {c.excerpt && (
                      <p className="text-[11px] text-gray-400 line-clamp-3">
                        {c.excerpt}
                      </p>
                    )}
                    {href && (
                      <a
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-block text-[11px] font-mono text-neon-400 hover:underline"
                      >
                        Jump to {c.timestamp} ↗
                      </a>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}