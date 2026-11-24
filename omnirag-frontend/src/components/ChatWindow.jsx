// File: omnirag-frontend/src/components/ChatWindow.jsx
import React, { useEffect, useRef } from 'react';

export default function ChatWindow({ messages, isStreaming }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming]);

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      {/* Top Header Bar */}
      <header className="h-14 px-6 flex items-center justify-between border-b border-midnight-700/80 shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-medium text-gray-100 tracking-tight">
            AI Research Assistant
          </h1>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-neon-500/15 text-neon-400 border border-neon-500/50 shadow-[0_0_12px_rgba(16,185,129,0.3)]">
            <span className="w-1.5 h-1.5 rounded-full bg-neon-400" />
            Active
          </span>
        </div>
      </header>

      {/* Scrollable Message List */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
        {messages.map((msg) => (
          <div key={msg.id} className="space-y-4">
            {/* User Prompt Row */}
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-midnight-800/90 border border-midnight-700/90">
              <div className="w-7 h-7 rounded-full bg-midnight-700 border border-gray-600/50 flex items-center justify-center shrink-0 text-gray-300">
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.75}
                    d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                  />
                </svg>
              </div>
              <p className="text-sm text-gray-200 leading-relaxed">
                {msg.question}
              </p>
            </div>

            {/* Assistant Response Container */}
            <div className="rounded-2xl bg-midnight-800/60 border border-midnight-700/90 p-5 space-y-4">
              {/* Assistant Header Row */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-full bg-neon-500/20 border border-neon-400/60 shadow-[0_0_12px_rgba(52,211,153,0.45)] flex items-center justify-center text-neon-400 shrink-0">
                    <svg
                      className="w-4 h-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 3v18m9-9H3m15.364-6.364l-12.728 12.728m0-12.728l12.728 12.728"
                      />
                    </svg>
                  </div>
                  <span className="text-sm font-medium text-gray-200">
                    {msg.heading || 'Assistant: Grounded RAG synthesis:'}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-neon-500/15 text-neon-400 border border-neon-500/40">
                    <span className="w-1.5 h-1.5 rounded-full bg-neon-400" />
                    Active
                  </span>
                  <span className="text-gray-500 px-1 text-sm select-none">
                    •••
                  </span>
                </div>
              </div>

              {/* Neon Glowing Inner Box (Code / Stream / Answer Display) */}
              <div className="relative rounded-xl bg-midnight-950/95 border border-neon-500/80 shadow-emerald-glow p-4 font-mono text-xs sm:text-[13px] leading-relaxed text-gray-200 overflow-x-auto">
                <span className="float-right ml-3 mb-2 inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-sans font-medium bg-neon-500/15 text-neon-400 border border-neon-500/40">
                  <span className="w-1.5 h-1.5 rounded-full bg-neon-400" />
                  Active
                </span>

                {msg.isDemoCode ? (
                  <pre className="text-gray-300 whitespace-pre-wrap">
                    <code>
                      <span className="text-neon-400">const</span> readult =
                      nowfddanet =&gt; {'{\n'}
                      {'  '}notfddates() = {'{\n'}
                      {'    '}
                      <span className="text-neon-400">return</span> swtng:{' '}
                      <span className="text-neon-400">new</span> nostiddetcor(
                      {'({\n'}
                      {'      '}system.locations = system.component6),{'\n'}
                      {'      '}root.omplete.toaade((
                      <span className="text-amber-300/90">
                        &apos;oriStringlmzcascode.v&apos;
                      </span>
                      ));{'\n'}
                      {'    });\n'}
                      {'  };\n'}
                      {'};'}
                    </code>
                  </pre>
                ) : (
               <div className="whitespace-pre-wrap font-sans text-sm text-gray-100 leading-relaxed">
                 {msg.error
                   ? 'Upstream API Error: Unable to generate grounded response right now. Please try again.'
                   : msg.isAbstained
                   ? 'Abstained: Search parameters unmet in ingested video corpus.'
                   : msg.answer
                   ? msg.answer.replace(/<chunk id="([^"]+)">/g, '[$1]')
                   : msg.rawStream || 'Streaming grounded response...'}
               </div>
             )}
              </div>

              {/* System Output Status Lines */}
              {msg.systemLogs && msg.systemLogs.length > 0 && (
                <div className="space-y-1 text-xs sm:text-[13px] text-gray-300 font-sans">
                  {msg.systemLogs.map((log, index) => (
                    <p key={index}>{log}</p>
                  ))}
                </div>
              )}

              {/* Citations Pills (When Live RAG Returns Grounded Video Timestamps) */}
              {msg.citations && msg.citations.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <span className="text-xs text-gray-400">Citations:</span>
                  {msg.citations.map((cit, idx) => (
                    <a
                      key={idx}
                      href={`https://www.youtube.com/watch?v=${cit.video_id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono bg-neon-500/15 text-neon-400 border border-neon-500/40 hover:bg-neon-500/25 transition-colors"
                    >
                      <span>{cit.chunk_id}</span>
                      <span className="text-gray-400">({cit.timestamp})</span>
                    </a>
                  ))}
                </div>
              )}

              {/* Error Banner for Upstream API / Network Failures */}
              {msg.error && (
                <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg bg-red-950/50 border border-red-500/60 text-red-300 text-xs sm:text-sm">
                  <svg
                    className="w-4 h-4 shrink-0 text-red-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <span className="break-all">API Error: {msg.error}</span>
                </div>
              )}

              {/* Amber Warning Box for Abstention */}
              {!msg.error && msg.isAbstained && (
                <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg bg-abstain-bg border border-abstain-border text-abstain-text text-xs sm:text-sm">
                  <svg
                    className="w-4 h-4 shrink-0 text-abstain-text"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                  <span>
                    {msg.abstainReason ||
                      'System Abstained: Search parameters unmet.'}
                  </span>
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}