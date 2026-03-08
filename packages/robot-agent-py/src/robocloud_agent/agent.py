"""RobotAgentProcess — async WebSocket client mirroring the TypeScript RobotAgentProcess."""

from __future__ import annotations

import asyncio
import json
import logging
import random
import time
from dataclasses import dataclass, field
from typing import Any

import websockets
from websockets.asyncio.client import ClientConnection

from .adapter import RobotAdapter
from .proto_utils import (
    decode_envelope,
    encode_heartbeat_envelope,
    encode_telemetry_envelope,
)

logger = logging.getLogger("robocloud.agent")


@dataclass
class AgentConfig:
    server_url: str
    adapter: RobotAdapter
    agent_secret: str = ""
    telemetry_rate_hz: float = 30.0
    reconnect_base_delay_s: float = 1.0
    reconnect_max_delay_s: float = 30.0


class RobotAgentProcess:
    """Connects to the RoboCloud API via WebSocket, dispatches commands, streams telemetry.

    Direct port of packages/robot-agent/src/robot-agent.ts.
    """

    def __init__(self, config: AgentConfig) -> None:
        self._config = config
        self._ws: ClientConnection | None = None
        self._current_session_id: str | None = None
        self._should_run = False
        self._reconnect_attempt = 0
        self._telemetry_task: asyncio.Task[None] | None = None
        self._sequence: int = 0
        self._run_task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        self._should_run = True
        await self._config.adapter.connect()
        self._run_task = asyncio.create_task(self._connect_loop())

    async def stop(self) -> None:
        self._should_run = False
        self._stop_telemetry_loop()
        if self._ws is not None:
            await self._ws.close()
            self._ws = None
        await self._config.adapter.disconnect()
        if self._run_task is not None:
            self._run_task.cancel()
            try:
                await self._run_task
            except asyncio.CancelledError:
                pass

    async def _connect_loop(self) -> None:
        """Outer loop: connect, run message pump, reconnect on failure."""
        while self._should_run:
            try:
                await self._connect()
            except asyncio.CancelledError:
                return
            except Exception as exc:
                logger.error("[agent] connection error: %s", exc)
            finally:
                self._stop_telemetry_loop()
                self._current_session_id = None
            if self._should_run:
                await self._wait_reconnect()

    async def _connect(self) -> None:
        robot_id = self._config.adapter.id
        url = f"{self._config.server_url}/robots/{robot_id}/agent"
        if self._config.agent_secret:
            from urllib.parse import quote
            url += f"?secret={quote(self._config.agent_secret)}"

        logger.info("[agent] connecting to %s/robots/%s/agent", self._config.server_url, robot_id)

        async with websockets.connect(url, max_size=16 * 1024 * 1024) as ws:
            self._ws = ws
            logger.info("[agent] connected as robot %s", robot_id)
            self._reconnect_attempt = 0
            self._send_registration()

            async for message in ws:
                if isinstance(message, (bytes, bytearray)):
                    try:
                        envelope = decode_envelope(message)
                        self._handle_envelope(envelope)
                    except Exception as exc:
                        logger.error("[agent] failed to decode envelope: %s", exc)

        logger.info("[agent] disconnected")
        self._ws = None

    async def _wait_reconnect(self) -> None:
        base = self._config.reconnect_base_delay_s
        mx = self._config.reconnect_max_delay_s
        exponential = min(mx, base * (2 ** self._reconnect_attempt))
        jitter = exponential * (0.5 + random.random() * 0.5)
        self._reconnect_attempt += 1
        logger.info("[agent] reconnecting in %.1fs (attempt %d)", jitter, self._reconnect_attempt)
        await asyncio.sleep(jitter)

    def _handle_envelope(self, envelope: dict[str, Any]) -> None:
        if "command" in envelope:
            self._config.adapter.send_command(envelope["command"])
        elif "session_control" in envelope:
            ctrl = envelope["session_control"]
            ctrl_type = ctrl.get("type")
            if ctrl_type == "start":
                session_id = envelope.get("session_id", "")
                logger.info("[agent] session started: %s", session_id)
                self._current_session_id = session_id
                self._sequence = 0
                self._start_telemetry_loop()
            elif ctrl_type == "stop":
                logger.info("[agent] session stopped: %s", envelope.get("session_id", ""))
                self._stop_telemetry_loop()
                self._current_session_id = None
            elif ctrl_type == "heartbeat":
                self._send_heartbeat_response()

    def _start_telemetry_loop(self) -> None:
        self._stop_telemetry_loop()
        self._telemetry_task = asyncio.create_task(self._telemetry_sender())

    def _stop_telemetry_loop(self) -> None:
        if self._telemetry_task is not None:
            self._telemetry_task.cancel()
            self._telemetry_task = None

    async def _telemetry_sender(self) -> None:
        interval = 1.0 / self._config.telemetry_rate_hz
        try:
            while True:
                if self._current_session_id and self._ws is not None:
                    telemetry = self._config.adapter.get_telemetry()
                    ts_us = int(time.monotonic() * 1_000_000)
                    data = encode_telemetry_envelope(
                        self._sequence, ts_us, self._current_session_id, telemetry
                    )
                    self._sequence += 1
                    await self._ws.send(data)
                await asyncio.sleep(interval)
        except asyncio.CancelledError:
            return

    def _send_heartbeat_response(self) -> None:
        if self._ws is None:
            return
        ts_us = int(time.monotonic() * 1_000_000)
        data = encode_heartbeat_envelope(self._current_session_id or "", ts_us)
        asyncio.ensure_future(self._ws.send(data))

    def _send_registration(self) -> None:
        if self._ws is None:
            return
        adapter = self._config.adapter
        caps = adapter.get_capabilities()
        registration = json.dumps({
            "type": "register",
            "robot": {
                "id": adapter.id,
                "name": adapter.name,
                "model": adapter.model,
                "capabilities": caps,
            },
        })
        asyncio.ensure_future(self._ws.send(registration))
