# File: voice-service/tests/test_voice_barge_in_race.py
from __future__ import annotations

import asyncio
import struct
import sys
from pathlib import Path
from typing import Any

import pytest

# Allow importing voice-service modules directly
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from voice_orchestrator import VoiceSessionOrchestrator
from voice_state import TwoFlagSessionState


class MockLiveSession:
    def __init__(self) -> None:
        self.tool_responses: list[Any] = []

    async def send_tool_response(self, function_responses: list[Any]) -> None:
        self.tool_responses.extend(function_responses)


class SlowMockRAGAdapter:
    """Simulates a slow MongoDB RRF + Cross-Encoder retrieval that pauses mid-flight."""

    def __init__(
        self,
        started_event: asyncio.Event,
        release_event: asyncio.Event,
        swallow_cancel: bool = False,
    ) -> None:
        self.started_event = started_event
        self.release_event = release_event
        self.swallow_cancel = swallow_cancel
        self.was_cancelled = False

    async def execute_tool(self, name: str, args: dict[str, Any] | None) -> dict[str, Any]:
        self.started_event.set()
        try:
            await self.release_event.wait()
        except asyncio.CancelledError:
            self.was_cancelled = True
            if not self.swallow_cancel:
                raise

        return {
            "status": "ok",
            "retryable": False,
            "message": "Found 1 grounded passage.",
            "passages": [
                {
                    "chunk_id": "vid_72x_14:32",
                    "video_id": "72x",
                    "title": "Advanced Distributed Systems",
                    "timestamp": "14:32",
                    "text": "Inject jitter to prevent the thundering herd problem.",
                }
            ],
            "citations": [
                {
                    "chunk_id": "vid_72x_14:32",
                    "video_id": "72x",
                    "title": "Advanced Distributed Systems",
                    "url": "https://youtube.com/watch?v=72x",
                    "timestamp": "14:32",
                    "score": 0.92,
                }
            ],
        }


@pytest.mark.asyncio
async def test_barge_in_cancels_in_flight_rag_and_blocks_stale_commit() -> None:
    started = asyncio.Event()
    release = asyncio.Event()

    emitted_json: list[dict[str, Any]] = []
    emitted_bytes: list[bytes] = []

    async def send_json(msg: dict[str, Any]) -> None:
        emitted_json.append(msg)

    async def send_bytes(data: bytes) -> None:
        emitted_bytes.append(data)

    state = TwoFlagSessionState()
    adapter = SlowMockRAGAdapter(started_event=started, release_event=release, swallow_cancel=False)
    live_session = MockLiveSession()
    orchestrator = VoiceSessionOrchestrator(
        tool_adapter=adapter,  # type: ignore[arg-type]
        send_json=send_json,
        send_bytes=send_bytes,
        state=state,
    )

    # 1. Start slow RAG tool call during Turn 1
    task = orchestrator.spawn_tool_call(
        live_session=live_session,
        call_id="call_turn1_slow",
        name="search_knowledge_base",
        args={"query": "jitter thundering herd", "top_k": 5},
    )
    await asyncio.wait_for(started.wait(), timeout=1.0)

    assert state.playback_epoch == 1
    assert state.active_turn_id == 1
    assert "call_turn1_slow" in state.in_flight_tasks

    # 2. User interrupts mid-flight (barge-in)
    snapshot = await orchestrator.handle_barge_in(reason="client_barge_in")
    committed = await task

    # 3. Verify Flag 1 & Flag 2 advanced, task cancelled, and ZERO stale outputs emitted
    assert committed is False
    assert adapter.was_cancelled is True
    assert snapshot["playback_epoch"] == 2
    assert snapshot["active_turn_id"] == 2
    assert "call_turn1_slow" in state.cancelled_tool_ids
    assert state.can_commit(task_turn_id=1, call_id="call_turn1_slow") is False

    citation_events = [m for m in emitted_json if m.get("type") == "rag_citations"]
    flush_events = [m for m in emitted_json if m.get("type") == "interrupt_flush"]
    cancel_events = [m for m in emitted_json if m.get("type") == "tool_cancelled"]

    assert len(citation_events) == 0, "Stale citations must never be emitted after barge-in"
    assert len(live_session.tool_responses) == 0, "Stale FunctionResponse must never be sent"
    assert len(flush_events) == 1 and flush_events[0]["playback_epoch"] == 2
    assert len(cancel_events) == 1 and "call_turn1_slow" in cancel_events[0]["call_ids"]


@pytest.mark.asyncio
async def test_boundary_race_stale_retrieval_returning_result_is_still_discarded() -> None:
    """
    Even if an underlying HTTP/DB call finishes right at the cancellation boundary
    (swallowing CancelledError and returning data), Flag 2 `can_commit()` must block it.
    """
    started = asyncio.Event()
    release = asyncio.Event()
    emitted_json: list[dict[str, Any]] = []

    async def send_json(msg: dict[str, Any]) -> None:
        emitted_json.append(msg)

    async def send_bytes(_: bytes) -> None:
        pass

    state = TwoFlagSessionState()
    adapter = SlowMockRAGAdapter(started_event=started, release_event=release, swallow_cancel=True)
    live_session = MockLiveSession()
    orchestrator = VoiceSessionOrchestrator(
        tool_adapter=adapter,  # type: ignore[arg-type]
        send_json=send_json,
        send_bytes=send_bytes,
        state=state,
    )

    task = orchestrator.spawn_tool_call(
        live_session=live_session,
        call_id="call_boundary_race",
        name="search_knowledge_base",
        args={"query": "raft quorum", "top_k": 5},
    )
    await asyncio.wait_for(started.wait(), timeout=1.0)

    await orchestrator.handle_barge_in(reason="server_interrupted")
    committed = await task

    assert committed is False
    assert [m for m in emitted_json if m.get("type") == "rag_citations"] == []
    assert live_session.tool_responses == []


@pytest.mark.asyncio
async def test_turn2_commits_cleanly_and_audio_header_is_little_endian_uint32() -> None:
    started = asyncio.Event()
    release = asyncio.Event()
    release.set()  # Resolves immediately without interruption

    emitted_json: list[dict[str, Any]] = []

    async def send_json(msg: dict[str, Any]) -> None:
        emitted_json.append(msg)

    async def send_bytes(_: bytes) -> None:
        pass

    state = TwoFlagSessionState(playback_epoch=3, active_turn_id=3)
    adapter = SlowMockRAGAdapter(started_event=started, release_event=release)
    live_session = MockLiveSession()
    orchestrator = VoiceSessionOrchestrator(
        tool_adapter=adapter,  # type: ignore[arg-type]
        send_json=send_json,
        send_bytes=send_bytes,
        state=state,
    )

    committed = await orchestrator.spawn_tool_call(
        live_session=live_session,
        call_id="call_turn3_ok",
        name="search_knowledge_base",
        args={"query": "jitter", "top_k": 5},
    )

    assert committed is True
    assert len(live_session.tool_responses) == 1
    assert live_session.tool_responses[0].id == "call_turn3_ok"
    assert any(m["type"] == "rag_citations" and m["turn_id"] == 3 for m in emitted_json)

    # Verify Flag 1 binary frame format: [uint32 little-endian epoch][PCM payload]
    sample_pcm = b"\x01\x02\x03\x04"
    framed = state.pack_audio_frame(sample_pcm)
    (unpacked_epoch,) = struct.unpack("<I", framed[:4])
    assert unpacked_epoch == 3
    assert framed[4:] == sample_pcm