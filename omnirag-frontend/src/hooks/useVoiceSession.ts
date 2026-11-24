// File: omnirag-frontend/src/hooks/useVoiceSession.ts
import { useCallback, useEffect, useRef, useState } from 'react';

export type VoiceStatus = 'OFFLINE' | 'LISTENING' | 'SPEAKING';
export type VoicePreset = 'Kore' | 'Charon' | 'Fenrir' | 'Puck' | 'Aoede';

export interface VoiceTranscriptEntry {
  id: string;
  role: 'user' | 'agent' | 'system';
  text: string;
  turnId: number;
  timestamp: string;
}

export interface VoiceCitation {
  chunk_id: string;
  video_id: string;
  title: string;
  url: string;
  timestamp: string;
  score: number;
  excerpt?: string;
}

export function useVoiceSession() {
  const [status, setStatus] = useState<VoiceStatus>('OFFLINE');
  const [voiceName, setVoiceName] = useState<VoicePreset>('Kore');
  const [isMuted, setIsMuted] = useState(false);
  const [playbackEpoch, setPlaybackEpoch] = useState(1);
  const [activeTurnId, setActiveTurnId] = useState(1);
  const [bargeInCount, setBargeInCount] = useState(0);
  const [droppedStalePackets, setDroppedStalePackets] = useState(0);
  const [transcripts, setTranscripts] = useState<VoiceTranscriptEntry[]>([]);
  const [citations, setCitations] = useState<VoiceCitation[]>([]);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micNodeRef = useRef<AudioWorkletNode | null>(null);
  const playerNodeRef = useRef<AudioWorkletNode | null>(null);

  // Hot-path refs to avoid stale closures inside worklet/WebSocket callbacks
  const playbackEpochRef = useRef<number>(1);
  const activeTurnIdRef = useRef<number>(1);
  const isPlayingRef = useRef<boolean>(false);

  const updateActiveTurnId = useCallback((nextTurn: number) => {
    activeTurnIdRef.current = nextTurn;
    setActiveTurnId(nextTurn);
  }, []);

  const appendTranscript = useCallback(
    (role: 'user' | 'agent' | 'system', text: string, turnId: number) => {
      const cleaned = text.trim();
      if (!cleaned) return;
      setTranscripts((prev) => {
        // Coalesce consecutive streaming deltas for the same role & turn
        const last = prev[prev.length - 1];
        if (last && last.role === role && last.turnId === turnId && role !== 'system') {
          const merged = `${last.text} ${cleaned}`.replace(/\s+/g, ' ').trim();
          return [...prev.slice(0, -1), { ...last, text: merged }];
        }
        return [
          ...prev,
          {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            role,
            text: cleaned,
            turnId,
            timestamp: new Date().toLocaleTimeString(),
          },
        ];
      });
    },
    []
  );

  const flushPlaybackLocally = useCallback((nextEpoch: number) => {
    playbackEpochRef.current = nextEpoch;
    setPlaybackEpoch(nextEpoch);
    isPlayingRef.current = false;
    playerNodeRef.current?.port.postMessage({ type: 'FLUSH' });
    setStatus((prev) => (prev === 'OFFLINE' ? 'OFFLINE' : 'LISTENING'));
  }, []);

  const triggerBargeIn = useCallback(
    (source: 'vad' | 'manual') => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      const nextEpoch = playbackEpochRef.current + 1;
      flushPlaybackLocally(nextEpoch);
      setBargeInCount((c) => c + 1);

      ws.send(
        JSON.stringify({
          type: 'barge_in',
          source,
          client_epoch: nextEpoch,
        })
      );
    },
    [flushPlaybackLocally]
  );

  const endSession = useCallback(() => {
    try {
      playerNodeRef.current?.port.postMessage({ type: 'FLUSH' });
    } catch {
      // ignore teardown race
    }
    wsRef.current?.close();
    wsRef.current = null;

    micNodeRef.current?.disconnect();
    micNodeRef.current = null;

    playerNodeRef.current?.disconnect();
    playerNodeRef.current = null;

    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;

    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close().catch(() => {});
    }
    audioCtxRef.current = null;

    isPlayingRef.current = false;
    setIsMuted(false);
    setStatus('OFFLINE');
  }, []);

  const startSession = useCallback(async () => {
    setError(null);
    endSession();

    try {
      // 1. Acquire mic with browser AEC/NS/AGC so speaker playback doesn't false-trigger VAD
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      micStreamRef.current = stream;

      const audioCtx = new AudioContext();
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }
      audioCtxRef.current = audioCtx;

      await audioCtx.audioWorklet.addModule('/worklets/mic-capture-processor.js');
      await audioCtx.audioWorklet.addModule('/worklets/pcm-player-processor.js');

      const micSource = audioCtx.createMediaStreamSource(stream);
      const micNode = new AudioWorkletNode(audioCtx, 'mic-capture-processor');
      const playerNode = new AudioWorkletNode(audioCtx, 'pcm-player-processor');

      // Keep mic worklet running without looping mic audio back to speakers
      const silentGain = audioCtx.createGain();
      silentGain.gain.value = 0;
      micSource.connect(micNode);
      micNode.connect(silentGain);
      silentGain.connect(audioCtx.destination);

      playerNode.connect(audioCtx.destination);

      micNodeRef.current = micNode;
      playerNodeRef.current = playerNode;

      // 2. Open WebSocket to /ws/voice (proxied by Vite -> FastAPI sidecar)
      const token = localStorage.getItem('omnirag_token') || '';
      const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProto}//${window.location.host}/ws/voice?token=${encodeURIComponent(
        token
      )}&voice=${encodeURIComponent(voiceName)}`;

      const ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      // Reset telemetry counters for new session
      playbackEpochRef.current = 1;
      setPlaybackEpoch(1);
      updateActiveTurnId(1);
      setBargeInCount(0);
      setDroppedStalePackets(0);
      setCitations([]);

      // Worklet -> WS upstream handlers
      micNode.port.onmessage = (event) => {
        const msg = event.data;
        if (!msg) return;
        if (msg.type === 'vad_speech_start') {
          if (isPlayingRef.current) {
            triggerBargeIn('vad');
          }
        } else if (msg.type === 'pcm' && ws.readyState === WebSocket.OPEN) {
          ws.send(msg.buffer);
        }
      };

      playerNode.port.onmessage = (event) => {
        const msg = event.data;
        if (msg?.type === 'playback_state') {
          isPlayingRef.current = Boolean(msg.playing);
          setStatus(msg.playing ? 'SPEAKING' : 'LISTENING');
        }
      };

      ws.onmessage = (event) => {
        // Binary downstream frame: [uint32 little-endian playback_epoch][24 kHz Int16 PCM]
        if (event.data instanceof ArrayBuffer) {
          if (event.data.byteLength <= 4) return;
          const view = new DataView(event.data);
          const frameEpoch = view.getUint32(0, true);

          // FLAG 1 CLIENT AUDIO FENCE: drop stale packets from interrupted epochs
          if (frameEpoch < playbackEpochRef.current) {
            setDroppedStalePackets((n) => n + 1);
            return;
          }

          const pcmSlice = event.data.slice(4);
          playerNode.port.postMessage({ type: 'PCM_24K', buffer: pcmSlice }, [
            pcmSlice,
          ]);
          return;
        }

        // JSON control/event frame
        try {
          const payload = JSON.parse(String(event.data));
          switch (payload.type) {
            case 'session_ready':
              playbackEpochRef.current = payload.playback_epoch ?? 1;
              setPlaybackEpoch(payload.playback_epoch ?? 1);
              updateActiveTurnId(payload.active_turn_id ?? 1);
              setStatus('LISTENING');
              appendTranscript(
                'system',
                `Connected to ${payload.model} (voice: ${payload.voice}, idle guard: ${payload.idle_timeout_sec}s).`,
                payload.active_turn_id ?? 1
              );
              break;

            case 'interrupt_flush': {
              const serverEpoch = Number(payload.playback_epoch || playbackEpochRef.current + 1);
              if (serverEpoch > playbackEpochRef.current) {
                flushPlaybackLocally(serverEpoch);
              }
              if (payload.active_turn_id) {
                updateActiveTurnId(Number(payload.active_turn_id));
              }
              if (payload.reason === 'server_interrupted') {
                setBargeInCount((c) => c + 1);
              }
              break;
            }

            case 'tool_cancelled':
              appendTranscript(
                'system',
                `Cancelled stale RAG tool call(s): ${(payload.call_ids || []).join(', ')}`,
                Number(payload.active_turn_id || activeTurnIdRef.current)
              );
              break;

            case 'rag_citations':
              setCitations(payload.citations || []);
              break;

            case 'transcript':
              appendTranscript(
                payload.role || 'agent',
                payload.text || '',
                Number(payload.turn_id || activeTurnIdRef.current)
              );
              break;

            case 'turn_complete':
              if (payload.active_turn_id) {
                updateActiveTurnId(Number(payload.active_turn_id));
              }
              break;

            case 'session_idle_closed':
              appendTranscript(
                'system',
                payload.message || 'Session closed due to 180s inactivity.',
                activeTurnIdRef.current
              );
              endSession();
              break;

            case 'error':
              setError(payload.message || 'Voice session error.');
              break;
          }
        } catch {
          // ignore malformed frames
        }
      };

      ws.onerror = () => {
        setError('WebSocket connection to /ws/voice failed. Verify voice-service is running on port 8000.');
      };

      ws.onclose = () => {
        setStatus('OFFLINE');
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start voice session.');
      endSession();
    }
  }, [appendTranscript, endSession, flushPlaybackLocally, triggerBargeIn, updateActiveTurnId, voiceName]);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      micNodeRef.current?.port.postMessage({ type: 'SET_MUTED', muted: next });
      return next;
    });
  }, []);

  const sendTextTurn = useCallback((text: string) => {
    const cleaned = text.trim();
    const ws = wsRef.current;
    if (!cleaned || !ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'text', text: cleaned }));
  }, []);

  useEffect(() => {
    return () => endSession();
  }, [endSession]);

  return {
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
    forceBargeIn: () => triggerBargeIn('manual'),
    sendTextTurn,
  };
}