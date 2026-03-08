import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import { create, toBinary, fromBinary } from "@bufbuild/protobuf";
import {
  EnvelopeSchema,
  CommandSchema,
  type TelemetryFrame,
} from "@robocloud/shared";
import { SimulatorAdapter } from "@robocloud/robot-agent/src/adapters/simulator.js";
import { RobotAgentProcess } from "@robocloud/robot-agent/src/robot-agent.js";

let server: FastifyInstance;
let serverUrl: string;
let serverPort: number;

async function createTestServer() {
  const mod = await import("@robocloud/api/src/test-helpers.js");
  return mod.createTestServer();
}

describe("RoboCloud E2E Integration", () => {
  let agent: RobotAgentProcess;

  beforeAll(async () => {
    server = await createTestServer();
    await server.listen({ port: 0, host: "127.0.0.1" });
    const address = server.addresses()[0];
    serverPort = address.port;
    serverUrl = `http://127.0.0.1:${serverPort}`;

    const adapter = new SimulatorAdapter({
      robotType: "arm6dof",
      robotId: "test-arm-001",
      robotName: "Test Arm",
      tickRateHz: 100,
    });

    agent = new RobotAgentProcess({
      serverUrl: `ws://127.0.0.1:${serverPort}`,
      adapter,
      telemetryRateHz: 50,
    });

    await agent.start();
    await new Promise((r) => setTimeout(r, 500));
  }, 15000);

  afterAll(async () => {
    if (agent) await agent.stop();
    if (server) await server.close();
  }, 10000);

  it("should list the connected robot with capabilities", async () => {
    const res = await fetch(`${serverUrl}/robots`);
    expect(res.status).toBe(200);
    const robots = await res.json() as any[];
    expect(robots.length).toBeGreaterThanOrEqual(1);

    const testRobot = robots.find((r: any) => r.id === "test-arm-001");
    expect(testRobot).toBeDefined();
    expect(testRobot.status).toBe("available");
    expect(testRobot.capabilities.joints.length).toBe(6);
    expect(testRobot.capabilities.endEffector).toBe(true);
    expect(testRobot.capabilities.cameras.length).toBe(1);
    expect(testRobot.capabilities.mobility).toBe("fixed");
  });

  it("should create a session, send commands, and receive telemetry via WebSocket", async () => {
    const createRes = await fetch(`${serverUrl}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ robotId: "test-arm-001", record: false }),
    });

    expect(createRes.status).toBe(201);
    const session = await createRes.json() as any;
    expect(session.id).toBeDefined();
    expect(session.status).toBe("active");

    const telemetryFrames: TelemetryFrame[] = [];

    const ws = new WebSocket(
      `ws://127.0.0.1:${serverPort}/sessions/${session.id}/control`
    );
    ws.binaryType = "arraybuffer";

    await new Promise<void>((resolve, reject) => {
      ws.on("open", resolve);
      ws.on("error", reject);
    });

    ws.on("message", (data: ArrayBuffer) => {
      try {
        const envelope = fromBinary(EnvelopeSchema, new Uint8Array(data));
        if (envelope.payload.case === "telemetry") {
          telemetryFrames.push(envelope.payload.value);
        }
      } catch { /* skip */ }
    });

    for (let i = 0; i < 25; i++) {
      const cmd = create(CommandSchema, {
        command: {
          case: "jointPosition",
          value: {
            positions: {
              shoulder_pan: Math.sin(i * 0.1) * 0.5,
              shoulder_lift: -0.3, elbow: 0.5,
              wrist_1: 0, wrist_2: 0, wrist_3: 0,
            },
          },
        },
      });
      const envelope = create(EnvelopeSchema, {
        sequence: BigInt(i),
        timestampUs: BigInt(Math.floor(performance.now() * 1000)),
        sessionId: session.id,
        payload: { case: "command", value: cmd },
      });
      ws.send(toBinary(EnvelopeSchema, envelope));
      await new Promise((r) => setTimeout(r, 20));
    }

    await new Promise((r) => setTimeout(r, 1000));

    expect(telemetryFrames.length).toBeGreaterThan(0);

    const lastFrame = telemetryFrames[telemetryFrames.length - 1];
    expect(lastFrame.jointStates).toBeDefined();
    expect(Object.keys(lastFrame.jointStates).length).toBe(6);
    expect(lastFrame.jointStates["shoulder_pan"]).toBeDefined();

    ws.close();
    await new Promise((r) => setTimeout(r, 200));

    const deleteRes = await fetch(`${serverUrl}/sessions/${session.id}`, { method: "DELETE" });
    expect(deleteRes.status).toBe(200);
    expect((await deleteRes.json() as any).status).toBe("ended");
  }, 30000);

  it("should record session data when record=true", async () => {
    const createRes = await fetch(`${serverUrl}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ robotId: "test-arm-001", record: true }),
    });
    expect(createRes.status).toBe(201);
    const session = await createRes.json() as any;

    const ws = new WebSocket(
      `ws://127.0.0.1:${serverPort}/sessions/${session.id}/control`
    );
    ws.binaryType = "arraybuffer";
    await new Promise<void>((resolve, reject) => {
      ws.on("open", resolve);
      ws.on("error", reject);
    });

    for (let i = 0; i < 10; i++) {
      const cmd = create(CommandSchema, {
        command: {
          case: "jointPosition",
          value: { positions: { shoulder_pan: i * 0.1, shoulder_lift: 0, elbow: 0, wrist_1: 0, wrist_2: 0, wrist_3: 0 } },
        },
      });
      const envelope = create(EnvelopeSchema, {
        sequence: BigInt(i),
        timestampUs: BigInt(Math.floor(performance.now() * 1000)),
        sessionId: session.id,
        payload: { case: "command", value: cmd },
      });
      ws.send(toBinary(EnvelopeSchema, envelope));
      await new Promise((r) => setTimeout(r, 30));
    }

    await new Promise((r) => setTimeout(r, 2000));
    ws.close();
    await new Promise((r) => setTimeout(r, 1000));

    const { existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    const recordingPath = join(process.cwd(), "recordings", session.id);
    expect(existsSync(recordingPath)).toBe(true);

    await fetch(`${serverUrl}/sessions/${session.id}`, { method: "DELETE" });
  }, 30000);

  it("should return 404 for non-existent robot", async () => {
    const res = await fetch(`${serverUrl}/robots/nonexistent`);
    expect(res.status).toBe(404);
  });

  it("should return health check", async () => {
    const res = await fetch(`${serverUrl}/health`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.status).toBe("ok");
  });
});
