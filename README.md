# RoboCloud

Cloud service for robotics teleoperation, dataset creation, and evaluation. Users rent a robot and remote-control it through a real-time API.

## Architecture

```
Client SDK ──REST + WS──▶ API Server ──WS (Protobuf)──▶ Robot Agent ──▶ Robot / Simulator
```

- **API Server** (Fastify) — REST endpoints for auth, robots, sessions + WebSocket bridge for real-time control
- **Robot Agent (TypeScript)** — runs alongside the robot (or simulator), connects to the API via WebSocket, dispatches commands and streams telemetry
- **Robot Agent (Python)** — parity implementation in Python, supports MuJoCo adapter with real rendered camera frames
- **Simulator** — time-stepped physics loop with simulated arm (6-DOF) and mobile (2D wheeled) robots
- **CLI** — `robocloud` command-line tool for managing robots, sessions, and recordings
- **SDK** — TypeScript client for programmatic control
- **Shared** — Protobuf-generated types, Zod schemas, adapter interfaces

### Real-Time Control Flow

1. Client creates a session via `POST /sessions`
2. Client opens a WebSocket to `/sessions/:id/control`
3. API bridges the WebSocket to the robot agent
4. Commands (Protobuf binary) flow: Client → API → Agent → Robot
5. Telemetry (Protobuf binary) flows back: Robot → Agent → API → Client
6. If recording is enabled, the API tees all frames to disk asynchronously

### Protocol

The wire protocol uses **Protocol Buffers** over WebSocket binary frames. All messages are wrapped in an `Envelope`:

```protobuf
message Envelope {
  uint64 sequence = 1;
  uint64 timestamp_us = 2;
  string session_id = 3;
  oneof payload {
    Command command = 10;
    TelemetryFrame telemetry = 11;
    SessionControl session_control = 12;
  }
}
```

Proto definitions live in `proto/robocloud/v1/`. TypeScript bindings are auto-generated into `packages/shared/src/generated/`.

## Quickstart

### Prerequisites

- Node.js >= 20
- pnpm >= 9
- [buf](https://buf.build/docs/installation) CLI (for Protobuf code generation)
- Docker + Docker Compose (optional, for containerised deployment)
- A [Supabase](https://supabase.com) project (for auth in production; tests run without it)

### Setup

```bash
# Install dependencies
pnpm install

# Copy environment template
cp .env.example .env
# Edit .env — key variables:
#   SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY / DATABASE_URL
#     → required for auth in production; omit for dev (auth endpoints return 501)
#   ROBOT_AGENT_SECRET  → shared secret robot agents must present to connect
#                         generate with: openssl rand -hex 32
#   API_PUBLIC_URL      → public-facing URL used in session responses (default: http://localhost:3000)

# Generate Protobuf TypeScript bindings
pnpm proto:generate

# Build all packages
pnpm build
```

### Run the API server

```bash
cd packages/api
pnpm dev
```

### Run a simulated robot agent (TypeScript — synthetic frames)

In a second terminal:

```bash
cd packages/robot-agent-ts
ROBOT_AGENT_WS_URL=ws://localhost:3000 ROBOT_TYPE=arm6dof ROBOT_ID=sim-arm-001 pnpm dev
```

### Run a MuJoCo robot agent (Python — rendered camera frames)

```bash
cd packages/robot-agent-py
python -m venv .venv && source .venv/bin/activate
pip install -e .
ROBOT_AGENT_WS_URL=ws://localhost:3000 ROBOT_TYPE=arm6dof ROBOT_ID=mujoco-arm6dof-001 python -m robocloud_agent.main
```

### Run with Docker Compose

Docker Compose is the easiest way to spin up the full stack. It builds all services from the `Dockerfile` and wires them together automatically.

```bash
# Start the API + a simulated arm agent
docker compose up --build

# Also start the mobile robot agent
docker compose --profile mobile up --build

# Also start the MuJoCo agent (requires OSMesa; rendered camera frames)
docker compose --profile mujoco up --build

# Both extra agents
docker compose --profile mobile --profile mujoco up --build
```

All services read from `.env`. The API is exposed on `http://localhost:3000` (configurable via `API_PORT`).

Recordings are stored in a named Docker volume (`recordings`) so they survive container restarts. To copy them to the host:

```bash
docker cp $(docker compose ps -q api):/app/recordings ./recordings
```

### Use the CLI

With the API server running, build and use the CLI:

```bash
# Build the CLI
pnpm --filter @robocloud/cli build

# Point at the local server (default is http://localhost:3000)
pnpm cli config set-url http://localhost:3000

# Authenticate (or set a dummy token in dev mode when Supabase is not configured)
pnpm cli login
# -- or, without Supabase --
pnpm cli config set-token dev-token

# List robots
pnpm cli robots list

# Create a session and start interactive control
pnpm cli sessions create sim-arm-001
pnpm cli control <session-id>

# Inside the control REPL:
#   j shoulder_pan 0.5    set a single joint
#   joints elbow=0.8 wrist_1=-0.3
#   gripper 0.5
#   help / q

# Download a recording
pnpm cli recordings info <session-id>
pnpm cli recordings download <session-id>
```

### Run tests

```bash
cd packages/sdk
pnpm test
```

## Monorepo Structure

```
packages/
  shared/               Protobuf types, Zod schemas, RobotAdapter interface
  api/                  Fastify API server + WebSocket bridge + recorder
  robot-agent-ts/       TypeScript agent: connects to API, dispatches commands to simulator
  robot-agent-py/       Python agent: MuJoCo adapter with real rendered camera frames
  simulator/            Time-stepped physics: Arm6DOF, Mobile2D
  sdk/                  Client SDK: RoboCloudClient, RoboCloudSession
  cli/                  robocloud CLI: auth, robots, sessions, recordings
proto/
  robocloud/v1/         .proto definitions (source of truth)
scripts/
  preview-recording.ts  Convert raw camera frames to PPM / mp4
```

## REST API

All endpoints except auth require a `Bearer` token in the `Authorization` header.


| Method   | Path                              | Description                                     |
| -------- | --------------------------------- | ----------------------------------------------- |
| `POST`   | `/auth/signup`                    | Create account                                  |
| `POST`   | `/auth/login`                     | Get access token                                |
| `GET`    | `/robots`                         | List available robots                           |
| `GET`    | `/robots/:id`                     | Robot details + capabilities                    |
| `POST`   | `/sessions`                       | Create session (reserves robot)                 |
| `GET`    | `/sessions/:id`                   | Session status                                  |
| `DELETE` | `/sessions/:id`                   | End session                                     |
| `GET`    | `/sessions/:id/recording`         | Recording metadata + file list                  |
| `GET`    | `/sessions/:id/recording/*`       | Download file (use stream aliases or raw path)  |
| `WS`     | `/sessions/:id/control`           | Real-time control (Protobuf binary)             |
| `WS`     | `/robots/:id/agent`               | Robot agent connection                          |


### Create Session

```bash
curl -X POST http://localhost:3000/sessions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"robotId": "sim-arm-001", "record": true}'
```

### SDK Usage

```typescript
import { RoboCloudClient } from "@robocloud/sdk";
import { create, CommandSchema } from "@robocloud/shared";

const client = new RoboCloudClient({ baseUrl: "http://localhost:3000" });
await client.login("user@example.com", "password");

const session = await client.createSession("sim-arm-001", { record: true });
await session.connect();

session.onTelemetry((telemetry) => {
  console.log("Joint states:", telemetry.jointStates);
});

session.sendJointPositions({
  shoulder_pan: 0.5,
  shoulder_lift: -0.3,
  elbow: 0.8,
  wrist_1: 0,
  wrist_2: 0,
  wrist_3: 0,
});

// When done
await session.disconnect();
await client.endSession(session.data.id);
```

## Tech Stack

- **TypeScript** monorepo (pnpm workspaces + Turborepo)
- **Fastify 5** with `@fastify/websocket`
- **Protocol Buffers** via `@bufbuild/protobuf` + `buf` toolchain
- **Supabase** (PostgreSQL, Auth, Storage)
- **Drizzle ORM** for type-safe database access
- **Vitest** for testing

## Recording Format

Sessions with `record: true` produce files in `recordings/<session-id>/`:


| File               | Format     | Content                                          |
| ------------------ | ---------- | ------------------------------------------------ |
| `metadata.json`    | JSON       | Robot info, timestamps, camera specs (w×h)       |
| `commands.jsonl`   | JSON Lines | Timestamped command index                        |
| `commands.binlog`  | Binary     | Raw Protobuf command frames                      |
| `telemetry.jsonl`  | JSON Lines | Timestamped telemetry index                      |
| `telemetry.binlog` | Binary     | Raw Protobuf telemetry frames                    |
| `cameras/*.raw`    | Binary     | Raw RGB camera frames (width×height×3 bytes each)|

Stream aliases accepted by `GET /sessions/:id/recording/<alias>`:
`metadata`, `commands`, `commands.binlog`, `telemetry`, `telemetry.binlog`.
Individual camera frames can be fetched by their relative path, e.g. `cameras/cam0_000001.raw`.

### Preview camera frames

```bash
# Convert raw RGB frames to PPM (dimensions auto-detected from metadata or file size)
npx tsx scripts/preview-recording.ts <session-id>

# Create a video with ffmpeg
ffmpeg -framerate 30 -pattern_type glob \
  -i 'recordings/<session-id>/preview/cam0_*.ppm' \
  -c:v libx264 -pix_fmt yuv420p recording.mp4
```


