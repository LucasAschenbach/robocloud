"""Tests for proto_utils — round-trip encode/decode and wire format verification."""

from robocloud_agent.proto_utils import (
    decode_envelope,
    encode_telemetry_envelope,
    encode_heartbeat_envelope,
    encode_envelope,
    encode_telemetry_frame,
    encode_camera_frame,
    _encode_varint,
    _decode_varint,
)


class TestVarint:
    def test_small_value(self) -> None:
        encoded = _encode_varint(42)
        value, pos = _decode_varint(encoded, 0)
        assert value == 42
        assert pos == len(encoded)

    def test_large_value(self) -> None:
        encoded = _encode_varint(300)
        value, pos = _decode_varint(encoded, 0)
        assert value == 300
        assert pos == len(encoded)

    def test_uint64_max(self) -> None:
        big = (1 << 63) - 1
        encoded = _encode_varint(big)
        value, pos = _decode_varint(encoded, 0)
        assert value == big

    def test_zero(self) -> None:
        encoded = _encode_varint(0)
        assert encoded == b"\x00"
        value, pos = _decode_varint(encoded, 0)
        assert value == 0


class TestTelemetryEnvelope:
    def test_round_trip(self) -> None:
        telemetry = {
            "timestamp_us": 123456789,
            "joint_states": {
                "shoulder_pan": {"position": 0.5, "velocity": 0.1, "torque": 0.0},
                "elbow": {"position": -1.2, "velocity": 0.0, "torque": 0.0},
            },
            "cameras": [
                {
                    "camera_name": "cam0",
                    "data": b"\xff\x00\x00" * 4,
                    "format": "raw",
                    "width": 2,
                    "height": 2,
                },
            ],
        }

        data = encode_telemetry_envelope(42, 1000000, "sess-001", telemetry)
        assert isinstance(data, bytes)
        assert len(data) > 0

        envelope = decode_envelope(data)
        assert envelope["sequence"] == 42
        assert envelope["timestamp_us"] == 1000000
        assert envelope["session_id"] == "sess-001"
        assert "telemetry" in envelope

    def test_empty_telemetry(self) -> None:
        telemetry = {"timestamp_us": 0, "joint_states": {}, "cameras": []}
        data = encode_telemetry_envelope(0, 0, "", telemetry)
        envelope = decode_envelope(data)
        assert envelope["sequence"] == 0
        assert "telemetry" in envelope


class TestHeartbeatEnvelope:
    def test_round_trip(self) -> None:
        data = encode_heartbeat_envelope("sess-002", 999999)
        envelope = decode_envelope(data)
        assert envelope["session_id"] == "sess-002"
        assert "session_control" in envelope
        ctrl = envelope["session_control"]
        assert ctrl["type"] == "heartbeat"
        assert ctrl["timestamp_us"] == 999999


class TestCameraFrame:
    def test_encode_produces_bytes(self) -> None:
        frame = {
            "camera_name": "cam0",
            "data": b"\x01\x02\x03",
            "format": "raw",
            "width": 320,
            "height": 240,
        }
        encoded = encode_camera_frame(frame)
        assert isinstance(encoded, bytes)
        assert len(encoded) > 10


class TestEnvelopeFieldNumbers:
    """Verify the wire format uses correct proto3 field numbers."""

    def test_telemetry_field_is_11(self) -> None:
        """Envelope.telemetry is oneof field 11 — tag byte should contain field 11."""
        telemetry = {"timestamp_us": 1, "joint_states": {}, "cameras": []}
        raw = encode_telemetry_envelope(1, 1, "s", telemetry)

        found_field_11 = False
        pos = 0
        while pos < len(raw):
            tag, new_pos = _decode_varint(raw, pos)
            field_number = tag >> 3
            wire_type = tag & 0x07
            if field_number == 11:
                found_field_11 = True
                break
            if wire_type == 0:
                _, pos = _decode_varint(raw, new_pos)
            elif wire_type == 1:
                pos = new_pos + 8
            elif wire_type == 2:
                length, pos = _decode_varint(raw, new_pos)
                pos += length
            elif wire_type == 5:
                pos = new_pos + 4
            else:
                break

        assert found_field_11, "Envelope should contain field 11 (telemetry)"
