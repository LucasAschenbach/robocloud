import WebSocket from "ws";
import { fromBinary, toBinary, create } from "@bufbuild/protobuf";
import {
  EnvelopeSchema,
  type Command,
  type RobotAdapter,
  type RobotCapabilities,
  RobotInfoSchema,
  type RobotInfo,
  RobotStatus,
} from "@robocloud/shared";
import { wrapTelemetry, resetSequence } from "./telemetry.js";
import { SimulatorAdapter } from "./adapters/simulator.js";

export interface AgentConfig {
  serverUrl: string;
  adapter: RobotAdapter;
  telemetryRateHz?: number;
  reconnectDelayMs?: number;
}

export class RobotAgentProcess {
  private config: AgentConfig;
  private ws: WebSocket | null = null;
  private telemetryInterval: ReturnType<typeof setInterval> | null = null;
  private currentSessionId: string | null = null;
  private shouldRun = false;

  constructor(config: AgentConfig) {
    this.config = {
      telemetryRateHz: 50,
      reconnectDelayMs: 3000,
      ...config,
    };
  }

  async start(): Promise<void> {
    this.shouldRun = true;
    await this.config.adapter.connect();
    this.connect();
  }

  async stop(): Promise<void> {
    this.shouldRun = false;
    this.stopTelemetryLoop();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    await this.config.adapter.disconnect();
  }

  private connect(): void {
    if (!this.shouldRun) return;

    const robotId = this.config.adapter.id;
    const url = `${this.config.serverUrl}/robots/${robotId}/agent`;
    console.log(`[agent] connecting to ${url}`);

    this.ws = new WebSocket(url);
    this.ws.binaryType = "arraybuffer";

    this.ws.on("open", () => {
      console.log(`[agent] connected as robot ${robotId}`);
      this.sendRegistration();
    });

    this.ws.on("message", (data: WebSocket.Data) => {
      if (data instanceof ArrayBuffer || Buffer.isBuffer(data)) {
        const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
        try {
          const envelope = fromBinary(EnvelopeSchema, bytes);
          this.handleEnvelope(envelope);
        } catch (err) {
          console.error("[agent] failed to decode envelope:", err);
        }
      }
    });

    this.ws.on("close", () => {
      console.log("[agent] disconnected");
      this.stopTelemetryLoop();
      this.currentSessionId = null;
      if (this.shouldRun) {
        console.log(`[agent] reconnecting in ${this.config.reconnectDelayMs}ms`);
        setTimeout(() => this.connect(), this.config.reconnectDelayMs);
      }
    });

    this.ws.on("error", (err) => {
      console.error("[agent] ws error:", err.message);
    });
  }

  private handleEnvelope(envelope: ReturnType<typeof fromBinary<typeof EnvelopeSchema>>): void {
    switch (envelope.payload.case) {
      case "command":
        this.config.adapter.sendCommand(envelope.payload.value);
        break;

      case "sessionControl": {
        const ctrl = envelope.payload.value;
        switch (ctrl.control.case) {
          case "start":
            console.log(`[agent] session started: ${envelope.sessionId}`);
            this.currentSessionId = envelope.sessionId;
            resetSequence();
            this.startTelemetryLoop();
            break;
          case "stop":
            console.log(`[agent] session stopped: ${envelope.sessionId}`);
            this.stopTelemetryLoop();
            this.currentSessionId = null;
            break;
          case "heartbeat":
            this.sendHeartbeatResponse();
            break;
          default:
            break;
        }
        break;
      }

      default:
        break;
    }
  }

  private startTelemetryLoop(): void {
    this.stopTelemetryLoop();
    const intervalMs = 1000 / (this.config.telemetryRateHz ?? 50);

    this.telemetryInterval = setInterval(() => {
      if (!this.currentSessionId || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

      const telemetry = this.config.adapter.getTelemetry();
      const bytes = wrapTelemetry(this.currentSessionId, telemetry);
      this.ws.send(bytes);
    }, intervalMs);
  }

  private stopTelemetryLoop(): void {
    if (this.telemetryInterval) {
      clearInterval(this.telemetryInterval);
      this.telemetryInterval = null;
    }
  }

  private sendHeartbeatResponse(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const envelope = create(EnvelopeSchema, {
      sequence: 0n,
      timestampUs: BigInt(Math.floor(performance.now() * 1000)),
      sessionId: this.currentSessionId ?? "",
      payload: {
        case: "sessionControl",
        value: {
          control: {
            case: "heartbeat",
            value: { timestampUs: BigInt(Math.floor(performance.now() * 1000)) },
          },
        },
      },
    });

    this.ws.send(toBinary(EnvelopeSchema, envelope));
  }

  private sendRegistration(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const info = this.getRobotInfo();
    const registrationMsg = JSON.stringify({
      type: "register",
      robot: {
        id: info.id,
        name: info.name,
        model: info.model,
        capabilities: {
          joints: info.capabilities?.joints.map((j) => ({
            name: j.name,
            minPosition: j.minPosition,
            maxPosition: j.maxPosition,
            maxVelocity: j.maxVelocity,
            maxTorque: j.maxTorque,
          })) ?? [],
          endEffector: info.capabilities?.endEffector ?? false,
          cameras: info.capabilities?.cameras.map((c) => ({
            name: c.name,
            width: c.width,
            height: c.height,
            fps: c.fps,
          })) ?? [],
          mobility: info.capabilities?.mobility ?? 0,
        },
      },
    });
    this.ws.send(registrationMsg);
  }

  getRobotInfo(): RobotInfo {
    const adapter = this.config.adapter;
    return create(RobotInfoSchema, {
      id: adapter.id,
      name: adapter.name,
      model: adapter.model,
      capabilities: adapter.getCapabilities(),
      status: RobotStatus.AVAILABLE,
    });
  }
}

async function main(): Promise<void> {
  const serverUrl = process.env["ROBOT_AGENT_WS_URL"] ?? "ws://localhost:3000";
  const robotType = (process.env["ROBOT_TYPE"] ?? "arm6dof") as "arm6dof" | "mobile2d";
  const robotId = process.env["ROBOT_ID"] ?? `sim-${robotType}-001`;
  const robotName = process.env["ROBOT_NAME"] ?? `Simulated ${robotType}`;

  const adapter = new SimulatorAdapter({
    robotType,
    robotId,
    robotName,
    tickRateHz: 100,
  });

  const agent = new RobotAgentProcess({
    serverUrl,
    adapter,
    telemetryRateHz: 50,
  });

  process.on("SIGINT", async () => {
    console.log("[agent] shutting down...");
    await agent.stop();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.log("[agent] shutting down...");
    await agent.stop();
    process.exit(0);
  });

  await agent.start();
  console.log(`[agent] robot ${robotId} (${robotType}) ready`);
}

main().catch((err) => {
  console.error("[agent] fatal:", err);
  process.exit(1);
});
