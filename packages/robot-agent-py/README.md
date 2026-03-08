# Python Robot Agent

Python parity implementation of the TypeScript `robot-agent-ts` package. Connects to the RoboCloud API server using the same Protobuf-over-WebSocket protocol.

The first adapter is **MuJoCo**, providing physics simulation with real rendered camera frames (not synthetic colors).

## Setup

```bash
# From the monorepo root
cd packages/robot-agent-py

# Create virtual environment
python -m venv .venv
source .venv/bin/activate

# Install with dependencies
pip install -e ".[test]"
```

### macOS

MuJoCo rendering works out of the box on macOS (uses CGL).

### Linux (headless)

Install OSMesa for headless rendering:

```bash
sudo apt-get install libegl1-mesa libgl1-mesa-glx libosmesa6
export MUJOCO_GL=osmesa
```

## Usage

```bash
# Make sure the API server is running first
# Then from packages/robot-agent-py:
python -m robocloud_agent.main
```

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `ROBOT_AGENT_WS_URL` | `ws://localhost:3000` | API server WebSocket URL |
| `ROBOT_TYPE` | `arm6dof` | Robot type (currently only `arm6dof`) |
| `ROBOT_ID` | `mujoco-arm6dof-001` | Robot identifier |
| `ROBOT_NAME` | `MuJoCo arm6dof` | Display name |
| `ROBOT_AGENT_SECRET` | (empty) | Agent authentication secret |
| `CAMERA_WIDTH` | `320` | Camera render width |
| `CAMERA_HEIGHT` | `240` | Camera render height |
| `CAMERA_FORMAT` | `raw` | `raw` (RGB bytes) or `jpeg` |
| `TELEMETRY_RATE_HZ` | `30` | Telemetry send rate |
| `MUJOCO_GL` | (auto) | Rendering backend: `osmesa`, `egl`, or `glfw` |

## Tests

```bash
pip install -e ".[test]"
pytest -v
```

## Docker

```bash
# From monorepo root
docker compose --profile mujoco up agent-mujoco
```

## Architecture

```
robocloud_agent/
  main.py           Entry point (env config, signal handling)
  agent.py          RobotAgentProcess (WS client, reconnect, telemetry loop)
  adapter.py        RobotAdapter Protocol class
  proto_utils.py    Protobuf encode/decode (wire-compatible with TS)
  adapters/
    mujoco_arm6dof.py   MuJoCo 6-DOF arm with offscreen camera rendering
```

The Python agent is a drop-in replacement for the TypeScript agent — it uses the same WebSocket endpoint (`/robots/:id/agent`), sends the same JSON registration, and exchanges the same Protobuf binary envelopes.
