// File: omnirag-frontend/src/App.jsx
import React, { useState, useEffect, useCallback } from 'react';
import TelemetrySidebar from './components/TelemetrySidebar';
import WorkspaceNavbar, { ProjectBrandHeader } from './components/TopNavbar';
import ChatWindow from './components/ChatWindow';
import CommandInput from './components/CommandInput';
import { AuthModal, IngestModal } from './components/Modals';
import { HistoryView, AboutView } from './components/WorkspaceViews';
import Login from './components/Login';

const INITIAL_MESSAGES = [
  // {
  //   id: 'welcome-1',
  //   question: 'hi',
  //   heading: 'Assistant: Grounded RAG synthesis:',
  //   isAbstained: true,
  //   abstainReason: 'System Abstained: Search parameters unmet.',
  //   systemLogs: [
  //     'System output: Model: gemini-3.1-flash-lite | TTFT: 0 ms',
  //     'System output: Tokens Consumed: 0 | Compaction Saved: 0',
  //     'System mattes: Abstained: Search parameters unmet.',
  //   ],
  //   citations: [],
  // },
];

export default function App() {
  // const [username, setUsername] = useState(
  //   () => localStorage.getItem('omnirag_user') || 'jeff_brokaw'
  // );
  // Replace your current useState with this:
const [username, setUsername] = useState(
  () => localStorage.getItem('omnirag_user') || ''
);
  const [activeTab, setActiveTab] = useState('chat');
  const [isIngestOpen, setIsIngestOpen] = useState(false);
  const [isAuthOpen, setIsAuthOpen] = useState(false);

  // const [telemetry, setTelemetry] = useState(null);
  const [telemetry, setTelemetry] = useState({
    total_requests: 0,
    abstention_rate: 0,
    avg_ttft_ms: 0,
    avg_total_latency_ms: 0,
    total_tokens_consumed: 0,
    total_tokens_saved_by_compaction: 0,
    cumulative_cost_usd: 0,
    recent_traces: [],
  });
  const [messages, setMessages] = useState(INITIAL_MESSAGES);
  const [query, setQuery] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);

  // const fetchTelemetry = useCallback(async () => {
  //   try {
  //     // 1. Get the token from local storage
  //     const token = localStorage.getItem('omnirag_token') || '';

  //     const res = await fetch('/api/telemetry/summary', {
  //       headers: {
  //         Authorization: `Bearer ${token}`,
  //       },
  //     });

  //     if (!res.ok) return;
  //     const data = await res.json();
  //     setTelemetry(data);
  //   } catch {
  //     // Keeps fallback metrics if backend is offline
  //   }
  // }, []);

  const fetchTelemetry = useCallback(async (overrideToken = null) => {
    try {
      // 1. Use the freshly passed login token first, otherwise read from local storage
      const token = overrideToken || localStorage.getItem('omnirag_token') || '';
      if (!token) return;

      const res = await fetch('/api/telemetry/summary', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) return;
      const data = await res.json();
      setTelemetry(data);
    } catch {
      // Keeps fallback metrics if backend is offline
    }
  }, []);

  useEffect(() => {
    fetchTelemetry();
  }, [fetchTelemetry]);

  // const handleSignIn = (newUsername, token = '') => {
  //   setUsername(newUsername);
  //   localStorage.setItem('omnirag_user', newUsername);
  //   if (token) {
  //     localStorage.setItem('omnirag_token', token);
  //   }
  // };

  // const handleLogoutOrSignInClick = () => {
  //   if (username) {
  //     setUsername('');
  //     localStorage.removeItem('omnirag_user');
  //     localStorage.removeItem('omnirag_token');
  //     setIsAuthOpen(true);
  //   } else {
  //     setIsAuthOpen(true);
  //   }
  // };

  const handleSignIn = (displayUsername, token = '') => {
    setUsername(displayUsername);
    localStorage.setItem('omnirag_user', displayUsername);
    if (token) {
      localStorage.setItem('omnirag_token', token);
    }
    setMessages([]);
    fetchTelemetry(token);
  };

  const handleLogoutOrSignInClick = () => {
    setUsername('');
    setMessages([]);
    setTelemetry({
      total_requests: 0,
      abstention_rate: 0,
      avg_ttft_ms: 0,
      avg_total_latency_ms: 0,
      total_tokens_consumed: 0,
      total_tokens_saved_by_compaction: 0,
      cumulative_cost_usd: 0,
      recent_traces: [],
    });
    localStorage.removeItem('omnirag_user');
    localStorage.removeItem('omnirag_token');
    // setIsAuthOpen(true);
    setIsAuthOpen(false);
  };


  const handleSendQuery = async (overrideQuery = null) => {
    const rawQuery = typeof overrideQuery === 'string' ? overrideQuery : query;
    const trimmed = rawQuery.trim();
    if (!trimmed || isStreaming) return;

    if (activeTab !== 'chat') {
      setActiveTab('chat');
    }

    const msgId = `msg-${Date.now()}`;
    const newMsg = {
      id: msgId,
      question: trimmed,
      heading: 'Assistant: Grounded RAG synthesis:',
      rawStream: '',
      answer: null,
      isAbstained: false,
      abstainReason: '',
      systemLogs: ['System output: Hybrid RRF + Cross-Encoder gate active...'],
      citations: [],
    };

    setMessages((prev) => [...prev, newMsg]);
    setQuery('');
    setIsStreaming(true);

    try {
      // 1.  Get the token from local storage
const token = localStorage.getItem('omnirag_token') || '';
      const response = await fetch('/api/query/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json',
          Authorization: `Bearer ${token}` 
         },
        
        body: JSON.stringify({ query: trimmed, topK: 5 }),
      });

      if (!response.ok || !response.body) {
        throw new Error(`Server returned ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        for (const evt of events) {
          const lines = evt.split('\n');
          const eventLine = lines.find((l) => l.startsWith('event:'));
          const dataLine = lines.find((l) => l.startsWith('data:'));

          if (!eventLine || !dataLine) continue;

          const eventType = eventLine.replace('event:', '').trim();
          const payload = JSON.parse(dataLine.replace('data:', '').trim());

          if (eventType === 'delta' && payload.chunk) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === msgId
                  ? { ...m, rawStream: (m.rawStream || '') + payload.chunk }
                  : m
              )
            );
          }

          if (eventType === 'complete') {
            const output = payload.output || {};
            const trace = payload.telemetry || {};

            setMessages((prev) =>
              prev.map((m) =>
                m.id === msgId
                  ? {
                      ...m,
                      answer: output.answer,
                      isAbstained: Boolean(output.is_abstained),
                      abstainReason:
                        'System Abstained: Search parameters unmet.',
                      citations: output.citations || [],
                      systemLogs: [
                        `System output: Model: ${
                          trace.model || 'gemini-2.5-flash'
                        } | TTFT: ${trace.latency_ms?.ttft ?? 0} ms`,
                        `System output: Tokens Consumed: ${
                          trace.tokens?.total ?? 0
                        } | Compaction Saved: ${
                          trace.tokens?.compaction_saved ?? 0
                        }`,
                        output.is_abstained
                          ? 'System mattes: Abstained: Search parameters unmet.'
                          : `System output: Verified ${
                              (output.citations || []).length
                            } inline citation(s).`,
                      ],
                    }
                  : m
              )
            );
            fetchTelemetry();
          }

          if (eventType === 'error') {
            throw new Error(
              payload.message || payload.error || 'SSE stream error'
            );
          }
        }
      }
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId
            ? {
                ...m,
                isAbstained: true,
                abstainReason: `System Abstained: ${err.message}`,
                systemLogs: [`System output: Error: ${err.message}`],
              }
            : m
        )
      );
    } finally {
      setIsStreaming(false);
    }
  };

  // Paste this right above your main return (...)
// if (!username) {
//     return (
//       <Login 
//         onLoginSuccess={(userData) => handleSignIn(userData.email, userData.token)} 
//       />
//     );
//   }

const handleLoadTrace = (trace) => {
    if (!trace) return;

    // Check if the answer was already generated in the current browser session
    const sessionMatch = messages.find(
      (m) => m.question === trace.query && (m.answer || m.isAbstained)
    );
    const resolvedAnswer = trace.answer || sessionMatch?.answer || null;
    const resolvedCitations =
      trace.citations?.length > 0
        ? trace.citations
        : sessionMatch?.citations || [];

    // If an older trace in MongoDB was logged before `answer` was stored, auto-run it once
    if (!trace.is_abstained && !resolvedAnswer) {
      setActiveTab('chat');
      handleSendQuery(trace.query);
      return;
    }

    const loadedMsg = {
      id: `history-${trace.request_id || Date.now()}`,
      question: trace.query,
      heading: 'Assistant: Grounded RAG synthesis (Loaded from History):',
      rawStream: '',
      answer: resolvedAnswer,
      isAbstained: Boolean(trace.is_abstained),
      abstainReason: 'System Abstained: Search parameters unmet.',
      citations: resolvedCitations,
      systemLogs: [
        `System output: Model: ${trace.model || 'gemini-2.5-flash'} | TTFT: ${
          trace.latency_ms?.ttft ?? 0
        } ms`,
        `System output: Tokens Consumed: ${
          trace.tokens?.total ?? 0
        } | Compaction Saved: ${trace.tokens?.compaction_saved ?? 0}`,
        trace.is_abstained
          ? 'System mattes: Abstained: Search parameters unmet.'
          : `System output: Verified ${resolvedCitations.length} inline citation(s).`,
      ],
    };

    setMessages((prev) => [
      ...prev.filter((m) => m.id !== loadedMsg.id),
      loadedMsg,
    ]);
    setActiveTab('chat');
  };

// const handleLoadTrace = (trace) => {
//     if (!trace) return;

//     const sessionMatch = messages.find(
//       (m) => m.question === trace.query && (m.answer || m.isAbstained)
//     );

//     const resolvedAnswer =
//       trace.answer ||
//       sessionMatch?.answer ||
//       'No saved answer text was stored for this older trace. Click "↻ Re-run" on the History card to generate a fresh answer.';

//     const resolvedCitations =
//       trace.citations?.length > 0
//         ? trace.citations
//         : sessionMatch?.citations || [];

//     const loadedMsg = {
//       id: `history-${trace.request_id || Date.now()}`,
//       question: trace.query,
//       heading: 'Assistant: Grounded RAG synthesis (Loaded from History):',
//       rawStream: '',
//       answer: resolvedAnswer,
//       isAbstained: Boolean(trace.is_abstained),
//       abstainReason: 'System Abstained: Search parameters unmet.',
//       citations: resolvedCitations,
//       systemLogs: [
//         `System output: Model: ${trace.model || 'gemini-2.5-flash'} | TTFT: ${
//           trace.latency_ms?.ttft ?? 0
//         } ms`,
//         `System output: Tokens Consumed: ${
//           trace.tokens?.total ?? 0
//         } | Compaction Saved: ${trace.tokens?.compaction_saved ?? 0}`,
//         trace.is_abstained
//           ? 'System mattes: Abstained: Search parameters unmet.'
//           : `System output: Verified ${resolvedCitations.length} inline citation(s).`,
//       ],
//     };

//     setMessages((prev) => [
//       ...prev.filter((m) => m.id !== loadedMsg.id),
//       loadedMsg,
//     ]);
//     setActiveTab('chat');
//   };

if (!username) {
    return (
      <Login
        onLoginSuccess={(userData) =>
          handleSignIn(userData.username || userData.email, userData.token)
        }
      />
    );
  }

  return (
    <div className="min-h-screen w-screen bg-midnight-950 flex flex-col items-center justify-center p-3 sm:p-6">
      {/* Top-Left Project Branding & Active Username */}
      {/* <ProjectBrandHeader username={username} /> */}

      <ProjectBrandHeader
        username={username}
        onLogoutClick={handleLogoutOrSignInClick}
      />

      {/* Main Outer Frame with Diffused Neon Green Ambient Glow */}
      <div className="w-full max-w-[1220px] h-[84vh] max-h-[750px] rounded-2xl bg-midnight-900 border border-neon-500/40 shadow-emerald-window flex overflow-hidden">
        {/* Left Column: Telemetry Sidebar */}
        <TelemetrySidebar telemetry={telemetry} />

        {/* Right Column: Top Navbar + Active View + Bottom Command Bar */}
        <main className="flex-1 flex flex-col min-w-0 bg-midnight-900">
          {/* <WorkspaceNavbar
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            onOpenIngest={() => setIsIngestOpen(true)}
            chatCount={messages.length}
            username={username}
            onLogoutClick={handleLogoutOrSignInClick}
          /> */}
          <WorkspaceNavbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onOpenIngest={() => setIsIngestOpen(true)}
        chatCount={messages.length}
      />

          {activeTab === 'chat' && (
            <ChatWindow messages={messages} isStreaming={isStreaming} />
          )}

          {/* {activeTab === 'history' && (
            <HistoryView
              telemetry={telemetry}
              messages={messages}
              onSelectQuery={(selectedQuery) => {
                setQuery(selectedQuery);
                setActiveTab('chat');
              }}
            />
          )} */}

          {activeTab === 'history' && (
            <HistoryView
              telemetry={telemetry}
              messages={messages}
              onLoadTrace={handleLoadTrace}
              onRerunQuery={(selectedQuery) => {
                setActiveTab('chat');
                handleSendQuery(selectedQuery);
              }}
            />
          )}

          {/* {activeTab === 'about' && <AboutView />}

          <CommandInput
            query={query}
            setQuery={setQuery}
            onSubmit={handleSendQuery}
            isStreaming={isStreaming}
          />
        </main> */}

        {activeTab === 'about' && <AboutView />}

          {activeTab === 'chat' && (
            <CommandInput
              query={query}
              setQuery={setQuery}
              onSubmit={handleSendQuery}
              isStreaming={isStreaming}
            />
          )}
        </main>
      </div>

      {/* + Ingest YouTube Modal */}
      <IngestModal
        isOpen={isIngestOpen}
        onClose={() => setIsIngestOpen(false)}
        onIngestSuccess={() => fetchTelemetry()}
      />

      {/* Username / Authentication Modal */}
      <AuthModal
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
        currentUsername={username}
        onSignIn={handleSignIn}
      />
    </div>
  );
}