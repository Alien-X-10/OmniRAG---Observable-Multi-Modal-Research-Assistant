# File: voice-service/voice_state.py
from __future__ import annotations

import asyncio
import struct
import time
from dataclasses import dataclass, field
from typing import Any


EPOCH_HEADER_STRUCT = struct.Struct("<I")  # 4-byte little-endian uint32


@dataclass
class TwoFlagSessionState:
    """
    Two-Flag Interruption State Machine for true barge-in safety:
      - Flag 1 (Client Audio Fence): `playback_epoch` prefixes every downstream 24 kHz PCM frame.
      - Flag 2 (Server Turn & Tool Fence): `active_turn_id` + `cancelled_tool_ids` gates all
        async RAG tool completions before citations or FunctionResponses can commit.
    """

    playback_epoch: int = 1
    active_turn_id: int = 1
    cancelled_tool_ids: set[str] = field(default_factory=set)
    in_flight_tasks: dict[str, asyncio.Task[Any]] = field(default_factory=dict)
    barge_in_count: int = 0
    consecutive_tool_calls: int = 0
    last_activity_monotonic: float = field(default_factory=time.monotonic)
    idle_timeout_sec: float = 180.0

    def touch_activity(self) -> None:
        self.last_activity_monotonic = time.monotonic()

    def idle_seconds(self) -> float:
        return time.monotonic() - self.last_activity_monotonic

    def is_idle_expired(self) -> bool:
        return self.idle_seconds() >= self.idle_timeout_sec

    def pack_audio_frame(self, pcm_24k_bytes: bytes, epoch: int | None = None) -> bytes:
        """Prefixes raw 24 kHz Int16 PCM bytes with a 4-byte little-endian uint32 playback_epoch."""
        target_epoch = self.playback_epoch if epoch is None else epoch
        return EPOCH_HEADER_STRUCT.pack(target_epoch) + pcm_24k_bytes

    def register_tool_task(self, call_id: str, task: asyncio.Task[Any]) -> int:
        """Stamps an async RAG task with the current active_turn_id and tracks it by call_id."""
        task_turn_id = self.active_turn_id
        self.in_flight_tasks[call_id] = task
        self.consecutive_tool_calls += 1
        self.touch_activity()
        return task_turn_id

    def unregister_tool_task(self, call_id: str) -> None:
        self.in_flight_tasks.pop(call_id, None)

    def can_commit(self, task_turn_id: int, call_id: str) -> bool:
        """
        Strict Flag 2 commit guard.
        Returns True ONLY if the tool task belongs to the still-active turn
        AND its call_id has not been cancelled.
        """
        return (
            task_turn_id == self.active_turn_id
            and call_id not in self.cancelled_tool_ids
        )

    def reset_turn_tool_counter(self) -> None:
        self.consecutive_tool_calls = 0

    def on_barge_in(
        self,
        reason: str = "client_barge_in",
        client_epoch: int | None = None,
    ) -> dict[str, Any]:
        """
        Triggered on client `barge_in` or Gemini `server_content.interrupted`.
        Advances both Flag 1 and Flag 2, marks all in-flight tool call_ids as cancelled,
        and cancels their running asyncio tasks immediately.
        """
        self.touch_activity()
        next_epoch = self.playback_epoch + 1
        if client_epoch is not None and client_epoch > next_epoch:
            next_epoch = client_epoch

        self.playback_epoch = next_epoch
        self.active_turn_id += 1
        self.barge_in_count += 1
        self.consecutive_tool_calls = 0

        cancelled_ids: list[str] = []
        for call_id, task in list(self.in_flight_tasks.items()):
            self.cancelled_tool_ids.add(call_id)
            cancelled_ids.append(call_id)
            if not task.done():
                task.cancel()
            self.in_flight_tasks.pop(call_id, None)

        return {
            "reason": reason,
            "playback_epoch": self.playback_epoch,
            "active_turn_id": self.active_turn_id,
            "barge_in_count": self.barge_in_count,
            "cancelled_tool_ids": cancelled_ids,
        }

    def on_tool_cancellation(self, call_ids: list[str]) -> dict[str, Any]:
        """
        Triggered on Gemini `tool_call_cancellation`.
        Advances both flags and cancels the specified in-flight tool tasks.
        """
        self.touch_activity()
        self.playback_epoch += 1
        self.active_turn_id += 1
        self.consecutive_tool_calls = 0

        cancelled_ids: list[str] = []
        for call_id in call_ids:
            self.cancelled_tool_ids.add(call_id)
            cancelled_ids.append(call_id)
            task = self.in_flight_tasks.pop(call_id, None)
            if task is not None and not task.done():
                task.cancel()

        return {
            "reason": "gemini_tool_call_cancellation",
            "playback_epoch": self.playback_epoch,
            "active_turn_id": self.active_turn_id,
            "barge_in_count": self.barge_in_count,
            "cancelled_tool_ids": cancelled_ids,
        }