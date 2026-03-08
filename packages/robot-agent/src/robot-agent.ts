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

export interface AgentConfig {
  serverUrl: string;
  adapter: RobotAdapter;
  agentSecret?: string;
  telemetryRateHz?: number;
  reconnectBaseDelayMs?: number;
  reconnectMaxDelayMs?: number;
}

export class RobotAgentProcess {
  private config: Required<Omit<AgentConfig, "agentSecret">> & { agentSecret: string };
  private ws: WebSocket | null = null;
  private telemetryInterval: ReturnType<typeof setInterval> | null = null;
  private currentSessionId: string | null = null;
  private shouldRun = false;
  private reconnectAttempt = 0;

  constructor(config: AgentConfig) {
    this.config = {
      telemetryRateHz: 50,
      reconnectBaseDelayMs: 1000,
      reconnectMaxDelayMs: 30000,
      agentSecret: "",
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
    let url = `${this.config.serverUrl}/robots/${robotId}/agent`;
    if (this.config.agentSecret) {
      url += `?secret=${encodeURIComponent(this.config.agentSecret)}`;
    }
    console.log(`[agent] connecting to ${this.config.serverUrl}/robots/${robotId}/agent`);

    this.ws = new WebSocket(url);
    this.ws.binaryType = "arraybuffer";

    this.ws.on("open", () => {
      console.log(`[agent] connected as robot ${robotId}`);
      this.reconnectAttempt = 0;
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

    this.ws.on("close", (code: number, reason: Buffer) => {
      console.log(`[agent] disconnected (code=${code}, reason=${reason?.toString() ?? ""})`);
      this.stopTelemetryLoop();
      this.currentSessionId = null;
      if (this.shouldRun) {
        this.scheduleReconnect();
      }
    });

    this.ws.on("error", (err) => {
      console.error("[agent] ws error:", err.message);
    });
  }

  private scheduleReconnect(): void {
    const base = this.config.reconnectBaseDelayMs;
    const max = this.config.reconnectMaxDelayMs;
    const exponential = Math.min(max, base * Math.pow(2, this.reconnectAttempt));
    const jitter = exponential * (0.5 + Math.random() * 0.5);
    const delay = Math.floor(jitter);

    this.reconnectAttempt++;
    console.log(`[agent] reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})`);
    setTimeout(() => this.connect(), delay);
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
    const intervalMs = 1000 / this.config.telemetryRateHz;

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
