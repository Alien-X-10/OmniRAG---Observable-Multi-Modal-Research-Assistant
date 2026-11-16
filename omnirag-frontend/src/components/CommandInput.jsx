// File: omnirag-frontend/src/components/CommandInput.jsx
import React, { useRef, useEffect } from 'react';

export default function CommandInput({
  query,
  setQuery,
  onSubmit,
  isStreaming,
}) {
  const inputRef = useRef(null);

  // Support Cmd+K / Ctrl+K keyboard shortcut to focus input
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleFormSubmit = (e) => {
    e.preventDefault();
    if (!query.trim() || isStreaming) return;
    onSubmit();
  };

  return (
    <div className="px-6 pb-5 pt-2">
      <form
        onSubmit={handleFormSubmit}
        className="relative flex items-center w-full rounded-2xl bg-midnight-800/95 border border-neon-500/80 shadow-emerald-input px-4 py-2 transition-all focus-within:border-neon-400"
      >
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={isStreaming}
          placeholder="Ask a question, enter a command, or paste a link..."
          className="flex-1 bg-transparent text-sm text-gray-100 placeholder-gray-400 focus:outline-none pr-4 disabled:opacity-50"
          autoComplete="off"
        />

        {/* Keyboard Shortcut Keycaps */}
        <div className="hidden sm:flex items-center gap-1 mr-3 select-none">
          <kbd className="px-1.5 py-0.5 text-[11px] font-mono text-gray-400 bg-midnight-900/90 border border-midnight-700 rounded">
            ⌘
          </kbd>
          <kbd className="px-1.5 py-0.5 text-[11px] font-mono text-gray-400 bg-midnight-900/90 border border-midnight-700 rounded">
            K
          </kbd>
        </div>

        {/* Pure Text Glowing Generate Button (No Gemini Star) */}
        <button
          type="submit"
          disabled={isStreaming || !query.trim()}
          className="px-5 py-2 rounded-xl font-medium text-sm text-midnight-950 bg-gradient-to-r from-neon-400 to-neon-500 shadow-emerald-btn hover:brightness-110 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isStreaming ? 'Generating...' : 'Generate'}
        </button>
      </form>
    </div>
  );
}