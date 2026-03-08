"""Entry point for the Python robot agent — mirrors packages/robot-agent/src/agent.ts."""

from __future__ import annotations

import asyncio
import logging
import os
import signal
import sys
from pathlib import Path


def _load_dotenv() -> None:
    """Search for .env up the directory tree (same logic as the TS agent)."""
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    d = Path(__file__).resolve().parent
    for _ in range(10):
        candidate = d / ".env"
        if candidate.is_file():
            load_dotenv(candidate)
            return
        parent = d.parent
        if parent == d:
            break
        d = parent


def main() -> None:
    _load_dotenv()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )

    server_url = os.environ.get("ROBOT_AGENT_WS_URL", "ws://localhost:3000")
    robot_type = os.environ.get("ROBOT_TYPE", "arm6dof")
    robot_id = os.environ.get("ROBOT_ID", f"mujoco-{robot_type}-001")
    robot_name = os.environ.get("ROBOT_NAME", f"MuJoCo {robot_type}")
    agent_secret = os.environ.get("ROBOT_AGENT_SECRET", "")
    camera_width = int(os.environ.get("CAMERA_WIDTH", "320"))
    camera_height = int(os.environ.get("CAMERA_HEIGHT", "240"))
    camera_format = os.environ.get("CAMERA_FORMAT", "raw")
    telemetry_hz = float(os.environ.get("TELEMETRY_RATE_HZ", "30"))

    if robot_type == "arm6dof":
        from .adapters.mujoco_arm6dof import MuJoCoAdapter

        adapter = MuJoCoAdapter(
            robot_id=robot_id,
            robot_name=robot_name,
            camera_width=camera_width,
            camera_height=camera_height,
            camera_format=camera_format,
        )
    else:
        print(f"[agent] unknown ROBOT_TYPE={robot_type!r}, only 'arm6dof' is supported", file=sys.stderr)
        sys.exit(1)

    from .agent import AgentConfig, RobotAgentProcess

    config = AgentConfig(
        server_url=server_url,
        adapter=adapter,
        agent_secret=agent_secret,
        telemetry_rate_hz=telemetry_hz,
    )
    agent = RobotAgentProcess(config)

    async def run() -> None:
        loop = asyncio.get_running_loop()

        async def shutdown() -> None:
            logging.info("[agent] shutting down...")
            await agent.stop()

        for sig in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(sig, lambda: asyncio.ensure_future(shutdown()))

        await agent.start()
        logging.info("[agent] robot %s (%s) ready — MuJoCo adapter", robot_id, robot_type)

        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            pass

    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
