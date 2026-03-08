"""MuJoCo 6-DOF arm adapter — physics simulation with real rendered camera frames."""

from __future__ import annotations

import io
import logging
import math
import time
import threading
from pathlib import Path
from typing import Any

import mujoco
import numpy as np

logger = logging.getLogger("robocloud.mujoco")

_MODELS_DIR = Path(__file__).resolve().parent.parent.parent.parent / "models"

JOINT_NAMES = [
    "shoulder_pan",
    "shoulder_lift",
    "elbow",
    "wrist_1",
    "wrist_2",
    "wrist_3",
]

JOINT_LIMITS: dict[str, tuple[float, float]] = {
    "shoulder_pan": (-math.pi, math.pi),
    "shoulder_lift": (-math.pi, 0.0),
    "elbow": (-math.pi, math.pi),
    "wrist_1": (-math.pi, math.pi),
    "wrist_2": (-math.pi, math.pi),
    "wrist_3": (-2 * math.pi, 2 * math.pi),
}

ACTUATOR_NAMES = [
    "act_shoulder_pan",
    "act_shoulder_lift",
    "act_elbow",
    "act_wrist_1",
    "act_wrist_2",
    "act_wrist_3",
]

FINGER_ACTUATORS = ["act_finger_left", "act_finger_right"]


class MuJoCoAdapter:
    """RobotAdapter implementation backed by MuJoCo physics + offscreen rendering."""

    def __init__(
        self,
        robot_id: str = "mujoco-arm6dof-001",
        robot_name: str = "MuJoCo 6-DOF Arm",
        model_path: str | Path | None = None,
        camera_width: int = 320,
        camera_height: int = 240,
        camera_name: str = "cam0",
        camera_format: str = "raw",
        physics_rate_hz: float = 500.0,
    ) -> None:
        self._id = robot_id
        self._name = robot_name
        self._model_path = Path(model_path) if model_path else _MODELS_DIR / "arm6dof.xml"
        self._camera_width = camera_width
        self._camera_height = camera_height
        self._camera_name = camera_name
        self._camera_format = camera_format
        self._physics_dt = 1.0 / physics_rate_hz

        self._model: mujoco.MjModel | None = None
        self._data: mujoco.MjData | None = None
        self._renderer: mujoco.Renderer | None = None

        self._joint_ids: dict[str, int] = {}
        self._joint_qpos_adr: dict[str, int] = {}
        self._joint_dof_adr: dict[str, int] = {}
        self._actuator_ids: dict[str, int] = {}
        self._camera_id: int = -1

        self._physics_thread: threading.Thread | None = None
        self._physics_running = False
        self._lock = threading.Lock()
        self._gripper_openness = 1.0

    @property
    def id(self) -> str:
        return self._id

    @property
    def name(self) -> str:
        return self._name

    @property
    def model(self) -> str:
        return "mujoco-arm6dof"

    def get_capabilities(self) -> dict[str, Any]:
        joints = []
        for jname in JOINT_NAMES:
            lo, hi = JOINT_LIMITS[jname]
            joints.append({
                "name": jname,
                "minPosition": lo,
                "maxPosition": hi,
                "maxVelocity": 3.0 if "wrist" in jname else 2.0,
                "maxTorque": 10.0,
            })
        return {
            "joints": joints,
            "endEffector": True,
            "cameras": [
                {
                    "name": self._camera_name,
                    "width": self._camera_width,
                    "height": self._camera_height,
                    "fps": 30,
                }
            ],
            "mobility": 1,  # MOBILITY_FIXED
        }

    def send_command(self, cmd: dict[str, Any]) -> None:
        cmd_type = cmd.get("type")
        with self._lock:
            if self._data is None:
                return
            if cmd_type == "joint_position":
                positions: dict[str, float] = cmd.get("positions", {})
                for jname, pos in positions.items():
                    act_name = f"act_{jname}"
                    if act_name in self._actuator_ids:
                        self._data.ctrl[self._actuator_ids[act_name]] = pos
            elif cmd_type == "joint_velocity":
                velocities: dict[str, float] = cmd.get("velocities", {})
                for jname, vel in velocities.items():
                    act_name = f"act_{jname}"
                    if act_name in self._actuator_ids and jname in self._joint_qpos_adr:
                        current = self._data.qpos[self._joint_qpos_adr[jname]]
                        self._data.ctrl[self._actuator_ids[act_name]] = current + vel * self._physics_dt
            elif cmd_type == "gripper":
                openness = cmd.get("openness", 1.0)
                self._gripper_openness = openness
                finger_pos = openness * 0.02 - 0.01
                for fa in FINGER_ACTUATORS:
                    if fa in self._actuator_ids:
                        self._data.ctrl[self._actuator_ids[fa]] = finger_pos

    def get_telemetry(self) -> dict[str, Any]:
        with self._lock:
            if self._data is None or self._model is None:
                return {"timestamp_us": 0, "joint_states": {}, "cameras": []}

            joint_states: dict[str, dict[str, float]] = {}
            for jname in JOINT_NAMES:
                if jname in self._joint_qpos_adr:
                    qpos_idx = self._joint_qpos_adr[jname]
                    dof_idx = self._joint_dof_adr[jname]
                    joint_states[jname] = {
                        "position": float(self._data.qpos[qpos_idx]),
                        "velocity": float(self._data.qvel[dof_idx]),
                        "torque": 0.0,
                    }

            frame = self._render_camera()

        cameras = []
        if frame is not None:
            cameras.append({
                "camera_name": self._camera_name,
                "data": frame,
                "format": self._camera_format,
                "width": self._camera_width,
                "height": self._camera_height,
            })

        return {
            "timestamp_us": int(time.monotonic() * 1_000_000),
            "joint_states": joint_states,
            "cameras": cameras,
        }

    async def connect(self) -> None:
        logger.info("[mujoco] loading model from %s", self._model_path)
        self._model = mujoco.MjModel.from_xml_path(str(self._model_path))
        self._data = mujoco.MjData(self._model)

        for jname in JOINT_NAMES:
            jid = mujoco.mj_name2id(self._model, mujoco.mjtObj.mjOBJ_JOINT, jname)
            self._joint_ids[jname] = jid
            self._joint_qpos_adr[jname] = self._model.jnt_qposadr[jid]
            self._joint_dof_adr[jname] = self._model.jnt_dofadr[jid]

        for aname in ACTUATOR_NAMES + FINGER_ACTUATORS:
            self._actuator_ids[aname] = mujoco.mj_name2id(
                self._model, mujoco.mjtObj.mjOBJ_ACTUATOR, aname
            )

        self._camera_id = mujoco.mj_name2id(
            self._model, mujoco.mjtObj.mjOBJ_CAMERA, self._camera_name
        )

        self._renderer = mujoco.Renderer(
            self._model, height=self._camera_height, width=self._camera_width
        )

        mujoco.mj_forward(self._model, self._data)

        self._physics_running = True
        self._physics_thread = threading.Thread(
            target=self._physics_loop, daemon=True, name="mujoco-physics"
        )
        self._physics_thread.start()
        logger.info("[mujoco] simulation running (%d Hz physics)", int(1.0 / self._physics_dt))

    async def disconnect(self) -> None:
        self._physics_running = False
        if self._physics_thread is not None:
            self._physics_thread.join(timeout=2.0)
            self._physics_thread = None
        if self._renderer is not None:
            self._renderer.close()
            self._renderer = None
        self._model = None
        self._data = None
        logger.info("[mujoco] simulation stopped")

    def _physics_loop(self) -> None:
        """Run physics steps in a background thread at the configured rate."""
        while self._physics_running:
            t0 = time.perf_counter()
            with self._lock:
                if self._model is not None and self._data is not None:
                    mujoco.mj_step(self._model, self._data)
            elapsed = time.perf_counter() - t0
            sleep_time = self._physics_dt - elapsed
            if sleep_time > 0:
                time.sleep(sleep_time)

    def _render_camera(self) -> bytes | None:
        """Render the camera to RGB bytes. Must be called with self._lock held."""
        if self._renderer is None or self._model is None or self._data is None:
            return None

        mujoco.mj_forward(self._model, self._data)
        self._renderer.update_scene(self._data, camera=self._camera_id)
        rgb_array: np.ndarray = self._renderer.render()

        if self._camera_format == "jpeg":
            return self._compress_jpeg(rgb_array)
        return rgb_array.tobytes()

    @staticmethod
    def _compress_jpeg(rgb_array: np.ndarray, quality: int = 85) -> bytes:
        from PIL import Image
        img = Image.fromarray(rgb_array)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=quality)
        return buf.getvalue()
