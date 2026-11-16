// File: omnirag-frontend/src/components/TelemetrySidebar.jsx
import React from 'react';

const ACTIVE_APIS = [
  { id: 1, name: 'Gemma 4 31B', active: true },
  { id: 2, name: 'Gemini 2.5 Flash', active: true },
  { id: 3, name: 'Gemini 2.5 Flash', active: true },
  { id: 4, name: 'Gemini 2.5 Flash', active: true },
  { id: 5, name: 'Gemma 4 31B', active: false },
];

export default function TelemetrySidebar({ telemetry }) {
  const avgTtft =
    telemetry?.avg_ttft_ms !== undefined
      ? telemetry.avg_ttft_ms.toLocaleString()
      : '1,790';

  const totalTokens =
    telemetry?.total_tokens_consumed !== undefined
      ? telemetry.total_tokens_consumed.toLocaleString()
      : '5,879';

  const costIncurred =
    telemetry?.cumulative_cost_usd !== undefined
      ? `$${Number(telemetry.cumulative_cost_usd).toFixed(6)}`
      : '$0.001519';

  const tokensSaved =
    telemetry?.total_tokens_saved_by_compaction !== undefined
      ? telemetry.total_tokens_saved_by_compaction.toLocaleString()
      : '96';

  return (
    <aside className="w-[260px] shrink-0 bg-midnight-900 border-r border-midnight-700/80 flex flex-col select-none">
      {/* Sidebar Header */}
      <div className="h-14 px-5 flex items-center justify-between border-b border-midnight-700/80">
        <h2 className="text-[15px] font-medium text-gray-200 tracking-tight">
          Telemetry Dashboard
        </h2>
        <span className="w-2.5 h-2.5 rounded-full bg-neon-400 shadow-[0_0_10px_#34d399]" />
      </div>

      {/* Metric Cards Stack */}
      <div className="p-4 flex-1 flex flex-col gap-3.5 overflow-y-auto">
        {/* Card 1: AVG TTFT (Highlighted Neon Glow Card) */}
        <div className="rounded-xl bg-gradient-to-b from-neon-500/15 to-midnight-800/90 border border-neon-500/80 shadow-emerald-glow p-4 transition-all">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
            AVG TTFT
          </div>
          <div className="mt-1.5 text-2xl font-semibold text-neon-400 tracking-tight">
            {avgTtft} ms
          </div>
        </div>

        {/* Card 2: TOTAL TOKENS */}
        <div className="rounded-xl bg-midnight-800/90 border border-midnight-700/90 p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
            TOTAL TOKENS
          </div>
          <div className="mt-1.5 text-2xl font-semibold text-gray-100 tracking-tight">
            {totalTokens}
          </div>
        </div>

        {/* Card 3: COST INCURRED */}
        <div className="rounded-xl bg-midnight-800/90 border border-midnight-700/90 p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
            COST INCURRED
          </div>
          <div className="mt-1.5 text-2xl font-semibold text-gray-100 tracking-tight">
            {costIncurred}
          </div>
        </div>

        {/* Card 4: TOKENS SAVED */}
        <div className="rounded-xl bg-midnight-800/90 border border-midnight-700/90 p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              TOKENS SAVED
            </span>
            {/* Mini Glowing Pill Indicator */}
            <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-neon-500/20 border border-neon-500/50 shadow-[0_0_12px_rgba(16,185,129,0.45)]">
              <span className="w-2 h-1.5 rounded-full bg-neon-400" />
              <span className="w-1.5 h-1.5 rounded-full bg-neon-400" />
              <span className="w-1.5 h-1.5 rounded-full bg-neon-500/40" />
            </div>
          </div>
          <div className="mt-1.5 text-2xl font-semibold text-gray-100 tracking-tight">
            {tokensSaved}
          </div>
        </div>

        {/* Card 5: Active APIs */}
        <div className="rounded-xl bg-midnight-800/90 border border-midnight-700/90 p-4 mt-auto">
          <div className="text-xs font-medium text-gray-300 mb-3">
            Active APIs
          </div>
          <ul className="space-y-2.5">
            {ACTIVE_APIS.map((api) => (
              <li
                key={api.id}
                className="flex items-center justify-between text-xs"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      api.active
                        ? 'bg-neon-400 shadow-[0_0_8px_#34d399]'
                        : 'bg-gray-600'
                    }`}
                  />
                  <span
                    className={
                      api.active
                        ? 'text-gray-200 font-medium'
                        : 'text-gray-500'
                    }
                  >
                    {api.name}
                  </span>
                </div>
                <span className="w-4 h-4 rounded-full bg-midnight-700 border border-gray-700/60 flex items-center justify-center text-[10px] text-gray-400">
                  {api.id}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </aside>
  );
}