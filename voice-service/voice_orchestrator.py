# File: voice-service/voice_orchestrator.py
from __future__ import annotations

import asyncio
import json
import logging
import os
from pathlib import Path
from typing import Any, Awaitable, Callable

from dotenv import load_dotenv
from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect
from google import genai
from google.genai import types

from rag_tool_adapter import OmniRAGToolAdapter, build_live_tools
from voice_state import TwoFlagSessionState

# Automatically load GEMINI_API_KEY from the root OmniRAG .env file (or local override)
ROOT_ENV_PATH = Path(__file__).resolve().parents[1] / ".env"
load_dotenv(dotenv_path=ROOT_ENV_PATH)
load_dotenv()

logger = logging.getLogger("omnirag.voice")
logging.basicConfig(level=logging.INFO)

VALID_VOICES = {"Charon", "Fenrir", "Puck", "Kore", "Aoede"}
MAX_CONSECUTIVE_TOOL_CALLS = 2
IDLE_TIMEOUT_SECONDS = 180.0

LIVE_MODEL = os.getenv("LIVE_MODEL", "gemini-3.8-live")
if LIVE_MODEL == "gemini-3.8-live-extended-thinking":
    logger.warning(
        "Overriding LIVE_MODEL=gemini-3.8-live-extended-thinking -> gemini-3.8-live "
        "to avoid AI Studio Developer API NON_BLOCKING tool handoff failures."
    )
    LIVE_MODEL = "gemini-3.8-live"

OMNIRAG_BACKEND_URL = os.getenv("OMNIRAG_BACKEND_URL", "http://localhost:3000")

VOICE_SYSTEM_INSTRUCTION = """You are OmniRAG Voice, a strict, zero-hallucination research assistant that ONLY knows what is inside the user's indexed sources.
GROUNDING & TOOL RULES:
1. You have ZERO outside world knowledge. For EVERY factual, historical, biographical, general-knowledge, or technical question—even famous people, history, or basic definitions—you MUST call `search_knowledge_base` first. Never answer any factual question from memory. Call `list_indexed_sources` when the user asks what videos or documents are available.
2. NEVER call tools more than 2 consecutive times for a single user turn:
   - If `search_knowledge_base` returns `status: "no_results"` or `is_abstained: true`, STOP immediately and ONLY reply: "I cannot answer that because it is not covered in your indexed sources." Do NOT add any background facts, summaries, or general knowledge.
   - If a tool returns `status: "error"`, STOP immediately and ONLY reply: "My knowledge base search is temporarily unavailable right now. Please try again in a moment." Do NOT guess or answer from general knowledge.
3. Speak naturally and concisely in plain spoken sentences. Do NOT read raw XML tags like <chunk id="..."> aloud; instead, briefly mention the source title or timestamp naturally (for example, "In the Distributed Systems lecture around 14:32...") while the UI displays the exact citations.
4. Keep answers direct so the user can easily interrupt or ask follow-up questions."""


def build_live_connect_config(voice_name: str = "Kore") -> types.LiveConnectConfig:
    """Constructs a clean LiveConnectConfig without legacy affective/proactivity fields."""
    selected_voice = voice_name if voice_name in VALID_VOICES else "Kore"
    return types.LiveConnectConfig(
        response_modalities=[types.Modality.AUDIO],
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(
                    voice_name=selected_voice
                )
            )
        ),
        tools=build_live_tools(),
        system_instruction=types.Content(
            parts=[types.Part(text=VOICE_SYSTEM_INSTRUCTION)]
        ),
    )


class VoiceSessionOrchestrator:
    """
    Coordinates the bidirectional Gemini Live session, TwoFlagSessionState,
    and async RAG tool execution. Decoupled send callbacks allow headless pytest verification.
    """

    def __init__(
        self,
        tool_adapter: OmniRAGToolAdapter,
        send_json: Callable[[dict[str, Any]], Awaitable[None]],
        send_bytes: Callable[[bytes], Awaitable[None]],
        state: TwoFlagSessionState | None = None,
    ) -> None:
        self.tool_adapter = tool_adapter
        self.send_json = send_json
        self.send_bytes = send_bytes
        self.state = state or TwoFlagSessionState(idle_timeout_sec=IDLE_TIMEOUT_SECONDS)

    async def handle_barge_in(
        self,
        reason: str = "client_barge_in",
        client_epoch: int | None = None,
    ) -> dict[str, Any]:
        snapshot = self.state.on_barge_in(reason=reason, client_epoch=client_epoch)
        await self.send_json(
            {
                "type": "interrupt_flush",
                "reason": snapshot["reason"],
                "playback_epoch": snapshot["playback_epoch"],
                "active_turn_id": snapshot["active_turn_id"],
                "barge_in_count": snapshot["barge_in_count"],
            }
        )
        if snapshot["cancelled_tool_ids"]:
            await self.send_json(
                {
                    "type": "tool_cancelled",
                    "call_ids": snapshot["cancelled_tool_ids"],
                    "active_turn_id": snapshot["active_turn_id"],
                }
            )
        return snapshot

    async def handle_tool_cancellation(self, call_ids: list[str]) -> dict[str, Any]:
        snapshot = self.state.on_tool_cancellation(call_ids)
        await self.send_json(
            {
                "type": "interrupt_flush",
                "reason": snapshot["reason"],
                "playback_epoch": snapshot["playback_epoch"],
                "active_turn_id": snapshot["active_turn_id"],
                "barge_in_count": snapshot["barge_in_count"],
            }
        )
        await self.send_json(
            {
                "type": "tool_cancelled",
                "call_ids": snapshot["cancelled_tool_ids"],
                "active_turn_id": snapshot["active_turn_id"],
            }
        )
        return snapshot

    def spawn_tool_call(
        self,
        live_session: Any,
        call_id: str,
        name: str,
        args: dict[str, Any] | None,
    ) -> asyncio.Task[bool]:
        """
        Spawns an async RAG retrieval task fenced by Flag 2 (`task_turn_id` + `call_id`).
        Returns the created Task (resolves True if committed, False if discarded/cancelled).
        """
        task_turn_id = self.state.active_turn_id

        async def _runner() -> bool:
            try:
                if self.state.consecutive_tool_calls > MAX_CONSECUTIVE_TOOL_CALLS:
                    result: dict[str, Any] = {
                        "status": "error",
                        "retryable": False,
                        "message": (
                            f"Consecutive tool call limit ({MAX_CONSECUTIVE_TOOL_CALLS}) reached "
                            "for this turn. Answer directly with available information or abstain."
                        ),
                        "passages": [],
                        "citations": [],
                    }
                else:
                    result = await self.tool_adapter.execute_tool(name, args)

                # STRICT FLAG 2 COMMIT FENCE:
                # Discard stale retrieval results silently if interrupted mid-flight.
                if not self.state.can_commit(task_turn_id, call_id):
                    logger.info(
                        "Discarded stale tool result call_id=%s (task_turn=%s vs active_turn=%s)",
                        call_id,
                        task_turn_id,
                        self.state.active_turn_id,
                    )
                    return False

                citations = result.get("citations") or []
                if citations:
                    await self.send_json(
                        {
                            "type": "rag_citations",
                            "turn_id": task_turn_id,
                            "call_id": call_id,
                            "tool": name,
                            "query": (args or {}).get("query", ""),
                            "citations": citations,
                        }
                    )

                # Re-check fence right before sending FunctionResponse over Gemini Live WS
                if not self.state.can_commit(task_turn_id, call_id):
                    return False

                await live_session.send_tool_response(
                    function_responses=[
                        types.FunctionResponse(
                            id=call_id,
                            name=name,
                            response=result,
                        )
                    ]
                )
                return True
            except asyncio.CancelledError:
                logger.info("Cancelled in-flight tool task call_id=%s", call_id)
                return False
            finally:
                self.state.unregister_tool_task(call_id)

        task = asyncio.create_task(_runner(), name=f"rag-tool-{call_id}")
        self.state.register_tool_task(call_id, task)
        return task

    async def process_gemini_message(self, live_session: Any, response: Any) -> None:
        """Handles a single inbound message from `live_session.receive()`."""
        self.state.touch_activity()

        # 1. Server-initiated tool cancellation
        tool_cancel = getattr(response, "tool_call_cancellation", None)
        if tool_cancel and getattr(tool_cancel, "ids", None):
            await self.handle_tool_cancellation(list(tool_cancel.ids))
            return

        # 2. Function calls -> spawn async Flag-2-fenced RAG tasks
        tool_call = getattr(response, "tool_call", None)
        if tool_call and getattr(tool_call, "function_calls", None):
            for fc in tool_call.function_calls:
                self.spawn_tool_call(
                    live_session=live_session,
                    call_id=fc.id,
                    name=fc.name,
                    args=dict(fc.args) if fc.args else {},
                )
            return

        server_content = getattr(response, "server_content", None)
        if not server_content:
            return

        # 3. Gemini server-side interruption -> immediate two-flag flush
        if getattr(server_content, "interrupted", False):
            await self.handle_barge_in(reason="server_interrupted")
            return

        # 4. Input / Output live transcriptions
        input_tx = getattr(server_content, "input_transcription", None)
        if input_tx and getattr(input_tx, "text", None):
            await self.send_json(
                {
                    "type": "transcript",
                    "role": "user",
                    "text": input_tx.text,
                    "turn_id": self.state.active_turn_id,
                }
            )

        output_tx = getattr(server_content, "output_transcription", None)
        if output_tx and getattr(output_tx, "text", None):
            await self.send_json(
                {
                    "type": "transcript",
                    "role": "agent",
                    "text": output_tx.text,
                    "turn_id": self.state.active_turn_id,
                }
            )

        # 5. Native 24 kHz Int16 PCM audio chunks -> stamp with Flag 1 epoch header
        model_turn = getattr(server_content, "model_turn", None)
        if model_turn and getattr(model_turn, "parts", None):
            current_epoch = self.state.playback_epoch
            for part in model_turn.parts:
                inline = getattr(part, "inline_data", None)
                if inline and getattr(inline, "data", None):
                    framed = self.state.pack_audio_frame(inline.data, epoch=current_epoch)
                    await self.send_bytes(framed)

        # 6. Turn completion
        if getattr(server_content, "turn_complete", False):
            self.state.reset_turn_tool_counter()
            await self.send_json(
                {
                    "type": "turn_complete",
                    "playback_epoch": self.state.playback_epoch,
                    "active_turn_id": self.state.active_turn_id,
                }
            )


app = FastAPI(title="OmniRAG Gemini 3.8 Live Voice Service")


@app.get("/health")
async def health() -> dict[str, Any]:
    return {"status": "ok", "service": "OmniRAG Voice Sidecar", "model": LIVE_MODEL}


@app.websocket("/ws/voice")
async def voice_ws_endpoint(
    websocket: WebSocket,
    token: str = Query(default=""),
    voice: str = Query(default="Kore"),
) -> None:
    await websocket.accept()

    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        await websocket.send_json(
            {"type": "error", "message": "GEMINI_API_KEY is not configured on the voice server."}
        )
        await websocket.close(code=1011)
        return

    ws_lock = asyncio.Lock()

    async def safe_send_json(payload: dict[str, Any]) -> None:
        async with ws_lock:
            await websocket.send_json(payload)

    async def safe_send_bytes(payload: bytes) -> None:
        async with ws_lock:
            await websocket.send_bytes(payload)

    state = TwoFlagSessionState(idle_timeout_sec=IDLE_TIMEOUT_SECONDS)
    adapter = OmniRAGToolAdapter(
        backend_base_url=OMNIRAG_BACKEND_URL,
        auth_token=token,
    )
    orchestrator = VoiceSessionOrchestrator(
        tool_adapter=adapter,
        send_json=safe_send_json,
        send_bytes=safe_send_bytes,
        state=state,
    )

    client = genai.Client(api_key=api_key, http_options={"api_version": "v1beta"})
    live_config = build_live_connect_config(voice_name=voice)
    stop_event = asyncio.Event()

    try:
        async with client.aio.live.connect(model=LIVE_MODEL, config=live_config) as live_session:
            await safe_send_json(
                {
                    "type": "session_ready",
                    "model": LIVE_MODEL,
                    "voice": voice if voice in VALID_VOICES else "Kore",
                    "playback_epoch": state.playback_epoch,
                    "active_turn_id": state.active_turn_id,
                    "idle_timeout_sec": int(IDLE_TIMEOUT_SECONDS),
                }
            )

            async def upstream_loop() -> None:
                try:
                    while not stop_event.is_set():
                        msg = await websocket.receive()
                        if msg["type"] == "websocket.disconnect":
                            stop_event.set()
                            break

                        state.touch_activity()

                        if msg.get("bytes") is not None:
                            pcm_16k = msg["bytes"]
                            if pcm_16k:
                                await live_session.send_realtime_input(
                                    audio=types.Blob(
                                        data=pcm_16k,
                                        mime_type="audio/pcm;rate=16000",
                                    )
                                )
                        elif msg.get("text") is not None:
                            data = json.loads(msg["text"])
                            msg_type = data.get("type")

                            if msg_type == "barge_in":
                                client_epoch = data.get("client_epoch")
                                await orchestrator.handle_barge_in(
                                    reason="client_barge_in",
                                    client_epoch=int(client_epoch) if client_epoch is not None else None,
                                )
                            elif msg_type == "text":
                                text_val = str(data.get("text", "")).strip()
                                if text_val:
                                    await safe_send_json(
                                        {
                                            "type": "transcript",
                                            "role": "user",
                                            "text": text_val,
                                            "turn_id": state.active_turn_id,
                                        }
                                    )
                                    await live_session.send_realtime_input(text=text_val)
                except WebSocketDisconnect:
                    stop_event.set()

            async def downstream_loop() -> None:
                # session.receive() yields per-turn; outer loop keeps multi-turn voice alive
                while not stop_event.is_set():
                    async for response in live_session.receive():
                        if stop_event.is_set():
                            break
                        await orchestrator.process_gemini_message(live_session, response)

            async def idle_watchdog() -> None:
                while not stop_event.is_set():
                    await asyncio.sleep(5.0)
                    if state.is_idle_expired():
                        await safe_send_json(
                            {
                                "type": "session_idle_closed",
                                "message": "Voice session closed after 180s of inactivity to protect Live API quota.",
                                "idle_timeout_sec": int(IDLE_TIMEOUT_SECONDS),
                            }
                        )
                        stop_event.set()
                        break

            tasks = [
                asyncio.create_task(upstream_loop(), name="voice-upstream"),
                asyncio.create_task(downstream_loop(), name="voice-downstream"),
                asyncio.create_task(idle_watchdog(), name="voice-idle-watchdog"),
            ]

            done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            stop_event.set()
            for t in pending:
                t.cancel()
            await asyncio.gather(*pending, return_exceptions=True)

            # Re-raise any unexpected task exception (other than CancelledError)
            for t in done:
                exc = t.exception()
                if exc and not isinstance(exc, (asyncio.CancelledError, WebSocketDisconnect)):
                    raise exc

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.exception("Voice session error: %s", exc)
        try:
            await safe_send_json({"type": "error", "message": str(exc)})
        except Exception:
            pass
    finally:
        # Cancel any lingering RAG tasks before teardown
        state.on_barge_in(reason="session_teardown")
        try:
            await websocket.close()
        except Exception:
            pass