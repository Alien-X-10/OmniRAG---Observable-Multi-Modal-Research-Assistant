// File: omnirag-frontend/src/components/TopNavbar.jsx
import React from 'react';

/**
 * Top-left project title & active username bar above the main glowing frame
 */
export function ProjectBrandHeader({ username, isGuest = false, onLogoutClick }) {
  return (
    <div className="w-full max-w-[1600px] mb-2.5 px-1 flex items-center justify-between select-none">
      <div>
        <h1 className="text-lg sm:text-2xl font-medium text-gray-200 tracking-tight">
          OmniRAG - Observable Multi-Modal Research Assistant
        </h1>
        <p className="text-xs sm:text-sm text-gray-500 font-mono mt-0.5 flex items-center gap-2">
          <span>
            user: <span className="text-gray-400">{username || 'guest'}</span>
          </span>
          {isGuest && (
            <span className="px-2 py-0.5 rounded-full text-[10px] bg-amber-500/10 border border-amber-500/40 text-amber-300">
              GUEST · 24H TEMP
            </span>
          )}
        </p>
      </div>

      <button
        type="button"
        onClick={onLogoutClick}
        className="px-4 py-1.5 rounded-lg bg-red-950/40 border border-red-500/80 text-xs font-medium text-red-400 shadow-[0_0_20px_rgba(239,68,68,0.45),inset_0_0_10px_rgba(239,68,68,0.2)] hover:bg-red-900/50 hover:border-red-400 hover:text-red-300 transition-all"
      >
        {username ? 'Logout' : 'Sign In'}
      </button>
    </div>
  );
}
/**
 * Inner top navigation bar for the right-hand AI workspace
 */
export default function WorkspaceNavbar({
  activeTab,
  setActiveTab,
  onOpenIngest,
  chatCount = 1,
  username,
  onLogoutClick,
}) {
  return (
    <header className="h-14 px-4 flex items-center justify-between border-b border-midnight-700/80 shrink-0 select-none">
      {/* Left/Center Navigation Pill */}
      <nav className="flex items-center gap-1 bg-midnight-800/90 border border-midnight-700/90 rounded-full px-2 py-1">
        {/* + Ingest Button */}
        <button
          type="button"
          onClick={onOpenIngest}
          className="flex items-center gap-1.5 px-3.5 py-1 rounded-full text-xs font-medium text-gray-300 hover:text-neon-400 hover:bg-midnight-700/60 transition-all"
        >
          <span className="text-base leading-none font-normal text-gray-400">+</span>
          <span>Ingest</span>
        </button>

        {/* Chat Button (with active neon pill & bottom glow bar) */}
        <div className="relative flex items-center">
          <button
            type="button"
            onClick={() => setActiveTab('chat')}
            className={`flex items-center gap-2 px-3.5 py-1 rounded-full text-xs font-medium transition-all ${
              activeTab === 'chat'
                ? 'bg-neon-500/20 text-neon-400 border border-neon-500/50 shadow-[0_0_15px_rgba(16,185,129,0.25)]'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {/* Chat Bubble Icon */}
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
              />
            </svg>
            <span>Chat</span>
            <span className="w-4 h-4 rounded-full bg-neon-500/30 border border-neon-400/60 text-[10px] text-neon-400 flex items-center justify-center font-semibold">
              {chatCount}
            </span>
          </button>

          {/* Glowing Neon Underline Indicator */}
          {activeTab === 'chat' && (
            <span className="absolute -bottom-[11px] left-2 right-2 h-[2px] bg-neon-400 rounded-full shadow-[0_0_12px_#34d399,0_0_20px_#10b981]" />
          )}
        </div>

        {/* History Button */}
        <div className="relative flex items-center">
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`flex items-center gap-1.5 px-3.5 py-1 rounded-full text-xs font-medium transition-all ${
              activeTab === 'history'
                ? 'bg-neon-500/20 text-neon-400 border border-neon-500/50 shadow-[0_0_15px_rgba(16,185,129,0.25)]'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {/* Clock / History Icon */}
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span>History</span>
          </button>

          {activeTab === 'history' && (
            <span className="absolute -bottom-[11px] left-2 right-2 h-[2px] bg-neon-400 rounded-full shadow-[0_0_12px_#34d399,0_0_20px_#10b981]" />
          )}
        </div>

        {/* About Button */}
        <div className="relative flex items-center">
          <button
            type="button"
            onClick={() => setActiveTab('about')}
            className={`flex items-center gap-1.5 px-3.5 py-1 rounded-full text-xs font-medium transition-all ${
              activeTab === 'about'
                ? 'bg-neon-500/20 text-neon-400 border border-neon-500/50 shadow-[0_0_15px_rgba(16,185,129,0.25)]'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            <span>About</span>
          </button>

          {activeTab === 'about' && (
            <span className="absolute -bottom-[11px] left-2 right-2 h-[2px] bg-neon-400 rounded-full shadow-[0_0_12px_#34d399,0_0_20px_#10b981]" />
          )}
        </div>
        {/* Voice Live Button */}
        <div className="relative flex items-center">
          <button
            type="button"
            onClick={() => setActiveTab('voice')}
            className={`flex items-center gap-1.5 px-3.5 py-1 rounded-full text-xs font-medium transition-all ${
              activeTab === 'voice'
                ? 'bg-neon-500/20 text-neon-400 border border-neon-500/50 shadow-[0_0_15px_rgba(16,185,129,0.25)]'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {/* Microphone Icon */}
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
              />
            </svg>
            <span>Voice Live</span>
          </button>

          {activeTab === 'voice' && (
            <span className="absolute -bottom-[11px] left-2 right-2 h-[2px] bg-neon-400 rounded-full shadow-[0_0_12px_#34d399,0_0_20px_#10b981]" />
          )}
        </div>
      </nav>

      {/* Far Right: Logout / Sign In Button */}
      {/* <button
        type="button"
        onClick={onLogoutClick}
        className="px-4 py-1.5 rounded-lg bg-midnight-800/90 border border-midnight-700 hover:border-neon-500/50 text-xs font-medium text-gray-300 hover:text-neon-400 transition-all"
      >
        {username ? 'Logout' : 'Sign In'}
      </button> */}
    </header>
  );
}