# RoboCloud

Cloud service for robotics teleoperation, dataset creation, and evaluation. Users rent a robot and remote-control it through a real-time API.

## Architecture

```
Client SDK ──REST + WS──▶ API Server ──WS (Protobuf)──▶ Robot Agent ──▶ Robot / Simulator
```

- **API Server** (Fastify) — REST endpoints for auth, robots, sessions + WebSocket bridge for real-time control
- **Robot Agent** — runs alongside the robot (or simulator), connects to the API via WebSocket, dispatches commands and streams telemetry
- **Simulator** — time-stepped physics loop with simulated arm (6-DOF) and mobile (2D wheeled) robots
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
- A [Supabase](https://supabase.com) project (for auth in production; tests run without it)

### Setup

```bash
# Install dependencies
pnpm install

# Copy environment template
cp .env.example .env
# Edit .env with your Supabase credentials

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

### Run a simulated robot agent

In a second terminal:

```bash
cd packages/robot-agent
ROBOT_AGENT_WS_URL=ws://localhost:3000 ROBOT_TYPE=arm6dof ROBOT_ID=sim-arm-001 pnpm dev
```

### Run tests

```bash
cd packages/sdk
pnpm test
```

## Monorepo Structure

```
packages/
  shared/        Protobuf types, Zod schemas, RobotAdapter interface
  api/           Fastify API server + WebSocket bridge + recorder
  robot-agent/   Connects to API, dispatches commands to robot/simulator
  simulator/     Time-stepped physics: Arm6DOF, Mobile2D
  sdk/           Client SDK: RoboCloudClient, RoboCloudSession
proto/
  robocloud/v1/  .proto definitions (source of truth)
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
| `GET`    | `/sessions/:id/recording/:stream` | Download stream (commands, telemetry, metadata) |
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


| File               | Format     | Content                       |
| ------------------ | ---------- | ----------------------------- |
| `metadata.json`    | JSON       | Robot info, timestamps        |
| `commands.jsonl`   | JSON Lines | Timestamped command index     |
| `commands.binlog`  | Binary     | Raw Protobuf command frames   |
| `telemetry.jsonl`  | JSON Lines | Timestamped telemetry index   |
| `telemetry.binlog` | Binary     | Raw Protobuf telemetry frames |
| `cameras/*.raw`    | Binary     | Camera frames                 |


