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
export type DisconnectCallback = (code: number, reason: string) => void;
export type ErrorCallback = (error: Error) => void;

export interface SessionConnectOptions {
  timeoutMs?: number;
}

export class RoboCloudSession {
  readonly data: SessionResponse;
  private ws: WebSocket | null = null;
  private wsUrl: string;
  private accessToken: string;
  private telemetryCallbacks: TelemetryCallback[] = [];
  private disconnectCallbacks: DisconnectCallback[] = [];
  private errorCallbacks: ErrorCallback[] = [];
  private sequence = 0n;
  private connected = false;
  private closePromiseResolve: (() => void) | null = null;

  constructor(data: SessionResponse, wsUrl: string, accessToken: string) {
    this.data = data;
    this.wsUrl = wsUrl;
    this.accessToken = accessToken;
  }

  async connect(options: SessionConnectOptions = {}): Promise<void> {
    const { timeoutMs = 5000 } = options;

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.ws) {
          this.ws.close();
          this.ws = null;
        }
        reject(new Error(`WebSocket connect timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const wsUrlWithToken = this.wsUrl.includes("?")
        ? `${this.wsUrl}&token=${encodeURIComponent(this.accessToken)}`
        : `${this.wsUrl}?token=${encodeURIComponent(this.accessToken)}`;

      this.ws = new WebSocket(wsUrlWithToken, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });
      this.ws.binaryType = "arraybuffer";

      this.ws.on("open", () => {
        clearTimeout(timer);
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

      this.ws.on("close", (code: number, reason: Buffer) => {
        const wasConnected = this.connected;
        this.connected = false;

        if (this.closePromiseResolve) {
          this.closePromiseResolve();
          this.closePromiseResolve = null;
        }

        const reasonStr = reason?.toString() ?? "";
        for (const cb of this.disconnectCallbacks) {
          cb(code, reasonStr);
        }
      });

      this.ws.on("error", (err) => {
        for (const cb of this.errorCallbacks) {
          cb(err);
        }

        if (!this.connected) {
          clearTimeout(timer);
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

  onDisconnect(callback: DisconnectCallback): () => void {
    this.disconnectCallbacks.push(callback);
    return () => {
      const idx = this.disconnectCallbacks.indexOf(callback);
      if (idx >= 0) this.disconnectCallbacks.splice(idx, 1);
    };
  }

  onError(callback: ErrorCallback): () => void {
    this.errorCallbacks.push(callback);
    return () => {
      const idx = this.errorCallbacks.indexOf(callback);
      if (idx >= 0) this.errorCallbacks.splice(idx, 1);
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
