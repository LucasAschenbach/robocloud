import WebSocket from "ws";
import { create, toBinary, fromBinary } from "@bufbuild/protobuf";
import {
  EnvelopeSchema,
  CommandSchema,
  type Envelope,
  type Command,
  type TelemetryFrame,
  type SessionResponse,
} from "@robocloud/shared";

export type TelemetryCallback = (telemetry: TelemetryFrame) => void;

export class RoboCloudSession {
  readonly data: SessionResponse;
  private ws: WebSocket | null = null;
  private wsUrl: string;
  private accessToken: string;
  private telemetryCallbacks: TelemetryCallback[] = [];
  private sequence = 0n;
  private connected = false;
  private closePromiseResolve: (() => void) | null = null;

  constructor(data: SessionResponse, wsUrl: string, accessToken: string) {
    this.data = data;
    this.wsUrl = wsUrl;
    this.accessToken = accessToken;
  }

  async connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });
      this.ws.binaryType = "arraybuffer";

      this.ws.on("open", () => {
        this.connected = true;
        resolve();
      });

      this.ws.on("message", (data: WebSocket.Data) => {
        if (data instanceof ArrayBuffer || Buffer.isBuffer(data)) {
          const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
          try {
            const envelope = fromBinary(EnvelopeSchema, bytes);
            if (envelope.payload.case === "telemetry") {
              for (const cb of this.telemetryCallbacks) {
                cb(envelope.payload.value);
              }
            }
          } catch {
            // Skip malformed frames
          }
        }
      });

      this.ws.on("close", () => {
        this.connected = false;
        if (this.closePromiseResolve) {
          this.closePromiseResolve();
          this.closePromiseResolve = null;
        }
      });

      this.ws.on("error", (err) => {
        if (!this.connected) {
          reject(err);
        }
      });
    });
  }

  sendCommand(cmd: Command): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Not connected");
    }

    const envelope: Envelope = create(EnvelopeSchema, {
      sequence: this.sequence++,
      timestampUs: BigInt(Math.floor(performance.now() * 1000)),
      sessionId: this.data.id,
      payload: {
        case: "command",
        value: cmd,
      },
    });

    this.ws.send(toBinary(EnvelopeSchema, envelope));
  }

  sendJointPositions(positions: Record<string, number>): void {
    const cmd = create(CommandSchema, {
      command: {
        case: "jointPosition",
        value: { positions },
      },
    });
    this.sendCommand(cmd);
  }

  sendGripper(openness: number): void {
    const cmd = create(CommandSchema, {
      command: {
        case: "gripper",
        value: { openness },
      },
    });
    this.sendCommand(cmd);
  }

  onTelemetry(callback: TelemetryCallback): () => void {
    this.telemetryCallbacks.push(callback);
    return () => {
      const idx = this.telemetryCallbacks.indexOf(callback);
      if (idx >= 0) this.telemetryCallbacks.splice(idx, 1);
    };
  }

  async disconnect(): Promise<void> {
    if (!this.ws) return;

    return new Promise<void>((resolve) => {
      this.closePromiseResolve = resolve;
      this.ws!.close();
    });
  }

  isConnected(): boolean {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }
}
