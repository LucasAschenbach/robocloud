"""RobotAdapter protocol — mirrors packages/shared/src/adapters.ts."""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable


@runtime_checkable
class RobotAdapter(Protocol):
    """Structural interface that every robot adapter must satisfy.

    Mirrors the TypeScript RobotAdapter interface from @robocloud/shared.
    """

    @property
    def id(self) -> str: ...

    @property
    def name(self) -> str: ...

    @property
    def model(self) -> str: ...

    def get_capabilities(self) -> dict[str, Any]:
        """Return robot capabilities dict matching the JSON registration schema."""
        ...

    def send_command(self, cmd: dict[str, Any]) -> None:
        """Apply an incoming command to the robot."""
        ...

    def get_telemetry(self) -> dict[str, Any]:
        """Return current telemetry including joint states and camera frames."""
        ...

    async def connect(self) -> None:
        """Initialize the robot / simulator."""
        ...

    async def disconnect(self) -> None:
        """Tear down the robot / simulator."""
        ...
