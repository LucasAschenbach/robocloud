"""Tests for the MuJoCo arm adapter — model loading, physics step, camera render."""

import math
import pytest
from robocloud_agent.adapters.mujoco_arm6dof import MuJoCoAdapter, JOINT_NAMES


def _can_create_renderer() -> bool:
    """Check if MuJoCo can create an offscreen GL context in this environment."""
    import mujoco
    from pathlib import Path

    model_path = Path(__file__).resolve().parent.parent / "models" / "arm6dof.xml"
    try:
        m = mujoco.MjModel.from_xml_path(str(model_path))
        r = mujoco.Renderer(m, height=4, width=4)
        r.close()
        return True
    except Exception:
        return False


_HAS_RENDERER = _can_create_renderer()
requires_renderer = pytest.mark.skipif(
    not _HAS_RENDERER,
    reason="MuJoCo offscreen rendering not available (no display / GL context)",
)


@pytest.fixture
async def adapter():
    if not _HAS_RENDERER:
        pytest.skip("MuJoCo offscreen rendering not available (no display / GL context)")
    a = MuJoCoAdapter(
        robot_id="test-arm",
        robot_name="Test Arm",
        camera_width=64,
        camera_height=64,
        camera_format="raw",
    )
    await a.connect()
    yield a
    await a.disconnect()


class TestMuJoCoAdapter:
    async def test_properties(self, adapter: MuJoCoAdapter) -> None:
        assert adapter.id == "test-arm"
        assert adapter.name == "Test Arm"
        assert adapter.model == "mujoco-arm6dof"

    async def test_capabilities(self, adapter: MuJoCoAdapter) -> None:
        caps = adapter.get_capabilities()
        assert "joints" in caps
        assert len(caps["joints"]) == 6
        joint_names = [j["name"] for j in caps["joints"]]
        assert joint_names == list(JOINT_NAMES)
        assert caps["endEffector"] is True
        assert len(caps["cameras"]) == 1
        assert caps["cameras"][0]["name"] == "cam0"
        assert caps["cameras"][0]["width"] == 64
        assert caps["cameras"][0]["height"] == 64

    async def test_telemetry_returns_joint_states(self, adapter: MuJoCoAdapter) -> None:
        telemetry = adapter.get_telemetry()
        assert "joint_states" in telemetry
        for jname in JOINT_NAMES:
            assert jname in telemetry["joint_states"]
            state = telemetry["joint_states"][jname]
            assert "position" in state
            assert "velocity" in state

    async def test_telemetry_returns_camera_frame(self, adapter: MuJoCoAdapter) -> None:
        telemetry = adapter.get_telemetry()
        assert "cameras" in telemetry
        assert len(telemetry["cameras"]) == 1
        cam = telemetry["cameras"][0]
        assert cam["camera_name"] == "cam0"
        assert cam["width"] == 64
        assert cam["height"] == 64
        assert cam["format"] == "raw"
        expected_size = 64 * 64 * 3
        assert len(cam["data"]) == expected_size

    async def test_camera_frame_is_not_blank(self, adapter: MuJoCoAdapter) -> None:
        """Rendered frames should have non-uniform pixel values (not all zeros)."""
        telemetry = adapter.get_telemetry()
        cam_data = telemetry["cameras"][0]["data"]
        unique_bytes = set(cam_data)
        assert len(unique_bytes) > 1, "Camera frame appears blank (all same byte value)"

    async def test_joint_position_command(self, adapter: MuJoCoAdapter) -> None:
        import asyncio

        adapter.send_command({
            "type": "joint_position",
            "positions": {"shoulder_pan": 0.5, "elbow": -0.3},
        })
        await asyncio.sleep(0.5)

        telemetry = adapter.get_telemetry()
        sp = telemetry["joint_states"]["shoulder_pan"]["position"]
        assert abs(sp - 0.5) < 0.5, f"shoulder_pan should be moving toward 0.5, got {sp}"

    async def test_gripper_command(self, adapter: MuJoCoAdapter) -> None:
        import asyncio

        adapter.send_command({"type": "gripper", "openness": 0.0})
        await asyncio.sleep(0.3)
        adapter.send_command({"type": "gripper", "openness": 1.0})
        await asyncio.sleep(0.3)

    @requires_renderer
    async def test_jpeg_format(self) -> None:
        a = MuJoCoAdapter(
            robot_id="test-jpeg",
            robot_name="Test JPEG",
            camera_width=64,
            camera_height=64,
            camera_format="jpeg",
        )
        await a.connect()
        try:
            telemetry = a.get_telemetry()
            cam = telemetry["cameras"][0]
            assert cam["format"] == "jpeg"
            assert cam["data"][:2] == b"\xff\xd8", "JPEG data should start with FFD8"
        finally:
            await a.disconnect()
