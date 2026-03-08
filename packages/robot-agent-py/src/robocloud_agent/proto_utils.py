"""Wire-compatible Protobuf encode/decode for the RoboCloud protocol.

Matches field numbers from proto/robocloud/v1/{protocol,common,robot}.proto exactly,
producing bytes identical to the TypeScript @bufbuild/protobuf encoding.

Uses google.protobuf raw descriptor-less encoding via the internal wire format helpers.
"""

from __future__ import annotations

import struct
from typing import Any

# ── Protobuf wire format primitives ──────────────────────────────────────────

WIRETYPE_VARINT = 0
WIRETYPE_FIXED64 = 1
WIRETYPE_LENGTH_DELIMITED = 2
WIRETYPE_FIXED32 = 5


def _encode_varint(value: int) -> bytes:
    pieces: list[int] = []
    while value > 0x7F:
        pieces.append((value & 0x7F) | 0x80)
        value >>= 7
    pieces.append(value & 0x7F)
    return bytes(pieces)


def _decode_varint(data: bytes, pos: int) -> tuple[int, int]:
    result = 0
    shift = 0
    while True:
        if pos >= len(data):
            raise ValueError("Truncated varint")
        b = data[pos]
        result |= (b & 0x7F) << shift
        pos += 1
        if (b & 0x80) == 0:
            break
        shift += 7
    return result, pos


def _encode_tag(field_number: int, wire_type: int) -> bytes:
    return _encode_varint((field_number << 3) | wire_type)


def _encode_uint64_field(field_number: int, value: int) -> bytes:
    if value == 0:
        return b""
    return _encode_tag(field_number, WIRETYPE_VARINT) + _encode_varint(value)


def _encode_string_field(field_number: int, value: str) -> bytes:
    if not value:
        return b""
    encoded = value.encode("utf-8")
    return (
        _encode_tag(field_number, WIRETYPE_LENGTH_DELIMITED)
        + _encode_varint(len(encoded))
        + encoded
    )


def _encode_bytes_field(field_number: int, value: bytes) -> bytes:
    if not value:
        return b""
    return (
        _encode_tag(field_number, WIRETYPE_LENGTH_DELIMITED)
        + _encode_varint(len(value))
        + value
    )


def _encode_submessage_field(field_number: int, data: bytes) -> bytes:
    if not data:
        return b""
    return (
        _encode_tag(field_number, WIRETYPE_LENGTH_DELIMITED)
        + _encode_varint(len(data))
        + data
    )


def _encode_double_field(field_number: int, value: float) -> bytes:
    if value == 0.0:
        return b""
    return _encode_tag(field_number, WIRETYPE_FIXED64) + struct.pack("<d", value)


def _encode_uint32_field(field_number: int, value: int) -> bytes:
    if value == 0:
        return b""
    return _encode_tag(field_number, WIRETYPE_VARINT) + _encode_varint(value)


def _encode_bool_field(field_number: int, value: bool) -> bytes:
    if not value:
        return b""
    return _encode_tag(field_number, WIRETYPE_VARINT) + b"\x01"


# ── Proto3 map<string, double> encoding ─────────────────────────────────────
# Each map entry is a submessage with key=field1(string), value=field2(double).

def _encode_map_string_double(field_number: int, mapping: dict[str, float]) -> bytes:
    result = b""
    for key, val in mapping.items():
        entry = _encode_string_field(1, key) + _encode_double_field(2, val)
        result += _encode_submessage_field(field_number, entry)
    return result


# ── Proto3 map<string, JointState> encoding ──────────────────────────────────
# JointState: position=1(double), velocity=2(double), torque=3(double)

def _encode_joint_state(state: dict[str, float]) -> bytes:
    return (
        _encode_double_field(1, state.get("position", 0.0))
        + _encode_double_field(2, state.get("velocity", 0.0))
        + _encode_double_field(3, state.get("torque", 0.0))
    )


def _encode_map_string_joint_state(
    field_number: int, mapping: dict[str, dict[str, float]]
) -> bytes:
    result = b""
    for key, state in mapping.items():
        state_bytes = _encode_joint_state(state)
        entry = _encode_string_field(1, key) + _encode_submessage_field(2, state_bytes)
        result += _encode_submessage_field(field_number, entry)
    return result


# ── Message encoders ─────────────────────────────────────────────────────────

def encode_camera_frame(frame: dict[str, Any]) -> bytes:
    """CameraFrame: camera_name=1, data=2, format=3, width=4, height=5."""
    return (
        _encode_string_field(1, frame.get("camera_name", ""))
        + _encode_bytes_field(2, frame.get("data", b""))
        + _encode_string_field(3, frame.get("format", ""))
        + _encode_uint32_field(4, frame.get("width", 0))
        + _encode_uint32_field(5, frame.get("height", 0))
    )


def encode_telemetry_frame(telemetry: dict[str, Any]) -> bytes:
    """TelemetryFrame: timestamp_us=1, joint_states=2(map), base_pose=3, cameras=4(repeated)."""
    result = _encode_uint64_field(1, telemetry.get("timestamp_us", 0))
    result += _encode_map_string_joint_state(2, telemetry.get("joint_states", {}))
    for cam in telemetry.get("cameras", []):
        cam_bytes = encode_camera_frame(cam)
        result += _encode_submessage_field(4, cam_bytes)
    return result


def encode_heartbeat(timestamp_us: int) -> bytes:
    """Heartbeat: timestamp_us=1."""
    return _encode_uint64_field(1, timestamp_us)


def encode_session_control_heartbeat(timestamp_us: int) -> bytes:
    """SessionControl with heartbeat (field 10)."""
    hb = encode_heartbeat(timestamp_us)
    return _encode_submessage_field(10, hb)


def _encode_submessage_field_always(field_number: int, data: bytes) -> bytes:
    """Like _encode_submessage_field but always emits the field, even for empty data.

    Required for oneof payload fields so the decoder can determine which case is active.
    """
    return (
        _encode_tag(field_number, WIRETYPE_LENGTH_DELIMITED)
        + _encode_varint(len(data))
        + data
    )


def encode_envelope(
    sequence: int,
    timestamp_us: int,
    session_id: str,
    payload_field: int,
    payload_bytes: bytes,
) -> bytes:
    """Envelope: sequence=1, timestamp_us=2, session_id=3, payload=oneof(10|11|12).

    payload_field: 10=command, 11=telemetry, 12=session_control
    """
    return (
        _encode_uint64_field(1, sequence)
        + _encode_uint64_field(2, timestamp_us)
        + _encode_string_field(3, session_id)
        + _encode_submessage_field_always(payload_field, payload_bytes)
    )


def encode_telemetry_envelope(
    sequence: int,
    timestamp_us: int,
    session_id: str,
    telemetry: dict[str, Any],
) -> bytes:
    """Convenience: wrap a telemetry dict into a full Envelope binary."""
    return encode_envelope(
        sequence, timestamp_us, session_id, 11, encode_telemetry_frame(telemetry)
    )


def encode_heartbeat_envelope(
    session_id: str, timestamp_us: int
) -> bytes:
    """Convenience: wrap a heartbeat response into a full Envelope binary."""
    return encode_envelope(
        0, timestamp_us, session_id, 12, encode_session_control_heartbeat(timestamp_us)
    )


# ── Decoders ─────────────────────────────────────────────────────────────────

def _decode_field(data: bytes, pos: int) -> tuple[int, int, Any, int]:
    """Decode one field. Returns (field_number, wire_type, value, new_pos)."""
    tag, pos = _decode_varint(data, pos)
    field_number = tag >> 3
    wire_type = tag & 0x07

    if wire_type == WIRETYPE_VARINT:
        value, pos = _decode_varint(data, pos)
        return field_number, wire_type, value, pos
    elif wire_type == WIRETYPE_FIXED64:
        value = data[pos : pos + 8]
        return field_number, wire_type, value, pos + 8
    elif wire_type == WIRETYPE_LENGTH_DELIMITED:
        length, pos = _decode_varint(data, pos)
        value = data[pos : pos + length]
        return field_number, wire_type, value, pos + length
    elif wire_type == WIRETYPE_FIXED32:
        value = data[pos : pos + 4]
        return field_number, wire_type, value, pos + 4
    else:
        raise ValueError(f"Unknown wire type {wire_type}")


def _decode_double(raw: bytes) -> float:
    return struct.unpack("<d", raw)[0]


def _decode_all_fields(data: bytes) -> list[tuple[int, int, Any]]:
    fields: list[tuple[int, int, Any]] = []
    pos = 0
    while pos < len(data):
        fn, wt, val, pos = _decode_field(data, pos)
        fields.append((fn, wt, val))
    return fields


def decode_joint_position_command(data: bytes) -> dict[str, float]:
    """JointPositionCommand: positions=1(map<string,double>)."""
    positions: dict[str, float] = {}
    for fn, _wt, val in _decode_all_fields(data):
        if fn == 1:
            key = ""
            dval = 0.0
            for efn, _ewt, eval_ in _decode_all_fields(val):
                if efn == 1:
                    key = eval_.decode("utf-8") if isinstance(eval_, (bytes, bytearray)) else str(eval_)
                elif efn == 2:
                    dval = _decode_double(eval_) if isinstance(eval_, (bytes, bytearray)) else float(eval_)
            if key:
                positions[key] = dval
    return positions


def decode_joint_velocity_command(data: bytes) -> dict[str, float]:
    """JointVelocityCommand: velocities=1(map<string,double>)."""
    return decode_joint_position_command(data)


def decode_gripper_command(data: bytes) -> float:
    """GripperCommand: openness=1(double)."""
    for fn, _wt, val in _decode_all_fields(data):
        if fn == 1:
            return _decode_double(val) if isinstance(val, (bytes, bytearray)) else float(val)
    return 0.0


def decode_command(data: bytes) -> dict[str, Any]:
    """Command: oneof command {joint_position=1, joint_velocity=2, ..., gripper=4, velocity=5}."""
    for fn, _wt, val in _decode_all_fields(data):
        if fn == 1:
            return {"type": "joint_position", "positions": decode_joint_position_command(val)}
        elif fn == 2:
            return {"type": "joint_velocity", "velocities": decode_joint_velocity_command(val)}
        elif fn == 4:
            return {"type": "gripper", "openness": decode_gripper_command(val)}
    return {"type": "unknown"}


def decode_session_control(data: bytes) -> dict[str, Any]:
    """SessionControl: oneof control {start=1, stop=2, pause=3, resume=4, heartbeat=10}."""
    for fn, _wt, val in _decode_all_fields(data):
        if fn == 1:
            fields = _decode_all_fields(val)
            robot_id = ""
            record = False
            for sfn, _swt, sval in fields:
                if sfn == 1:
                    robot_id = sval.decode("utf-8") if isinstance(sval, (bytes, bytearray)) else str(sval)
                elif sfn == 2:
                    record = bool(sval)
            return {"type": "start", "robot_id": robot_id, "record": record}
        elif fn == 2:
            return {"type": "stop"}
        elif fn == 3:
            return {"type": "pause"}
        elif fn == 4:
            return {"type": "resume"}
        elif fn == 10:
            ts = 0
            for sfn, _swt, sval in _decode_all_fields(val):
                if sfn == 1:
                    ts = sval if isinstance(sval, int) else 0
            return {"type": "heartbeat", "timestamp_us": ts}
    return {"type": "unknown"}


def decode_envelope(data: bytes) -> dict[str, Any]:
    """Decode a full Envelope binary message.

    Returns dict with keys: sequence, timestamp_us, session_id,
    and one of: command, telemetry, session_control.
    """
    result: dict[str, Any] = {
        "sequence": 0,
        "timestamp_us": 0,
        "session_id": "",
    }
    for fn, _wt, val in _decode_all_fields(data):
        if fn == 1:
            result["sequence"] = val if isinstance(val, int) else 0
        elif fn == 2:
            result["timestamp_us"] = val if isinstance(val, int) else 0
        elif fn == 3:
            result["session_id"] = val.decode("utf-8") if isinstance(val, (bytes, bytearray)) else str(val)
        elif fn == 10:
            result["command"] = decode_command(val)
        elif fn == 11:
            result["telemetry"] = val  # raw bytes, rarely needed on agent side
        elif fn == 12:
            result["session_control"] = decode_session_control(val)
    return result
