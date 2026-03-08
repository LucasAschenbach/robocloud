import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fromBinary } from "@bufbuild/protobuf";
import { EnvelopeSchema, type Envelope } from "@robocloud/shared";

interface RecordingEntry {
  timestampUs: string;
  sequence: string;
  type: string;
  subType?: string;
}

export class SessionRecorder {
  private sessionId: string;
  private basePath: string;
  private commandLog: RecordingEntry[] = [];
  private telemetryLog: RecordingEntry[] = [];
  private commandBinChunks: Uint8Array[] = [];
  private telemetryBinChunks: Uint8Array[] = [];
  private cameraFrameCount = 0;
  private isActive = false;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private metadata: Record<string, unknown>;

  constructor(sessionId: string, robotId: string, robotModel: string) {
    this.sessionId = sessionId;
    this.basePath = join(process.cwd(), "recordings", sessionId);
    this.metadata = {
      sessionId,
      robotId,
      robotModel,
      startTime: new Date().toISOString(),
      endTime: null,
    };
  }

  async start(): Promise<void> {
    this.isActive = true;
    await mkdir(join(this.basePath, "cameras"), { recursive: true });

    this.flushTimer = setInterval(() => {
      this.flush().catch((err) => console.error("[recorder] flush error:", err));
    }, 5000);
  }

  recordRawFrame(data: Uint8Array, direction: "command" | "telemetry"): void {
    if (!this.isActive) return;

    try {
      const envelope = fromBinary(EnvelopeSchema, data);
      this.recordEnvelope(envelope, data, direction);
    } catch {
      // Non-critical: skip malformed frames
    }
  }

  private recordEnvelope(envelope: Envelope, raw: Uint8Array, direction: "command" | "telemetry"): void {
    const entry: RecordingEntry = {
      timestampUs: envelope.timestampUs.toString(),
      sequence: envelope.sequence.toString(),
      type: direction,
    };

    if (direction === "command" && envelope.payload.case === "command") {
      entry.subType = envelope.payload.value.command.case ?? "unknown";
      this.commandLog.push(entry);
      this.commandBinChunks.push(raw);
    } else if (direction === "telemetry" && envelope.payload.case === "telemetry") {
      entry.subType = "telemetry";
      this.telemetryLog.push(entry);
      this.telemetryBinChunks.push(raw);

      const telemetry = envelope.payload.value;
      for (const camera of telemetry.cameras) {
        if (camera.data.length > 0) {
          this.cameraFrameCount++;
          const filename = `${camera.cameraName}_${String(this.cameraFrameCount).padStart(6, "0")}.raw`;
          writeFile(join(this.basePath, "cameras", filename), camera.data).catch(() => {});
        }
      }
    }
  }

  private async flush(): Promise<void> {
    if (this.commandLog.length > 0) {
      const jsonl = this.commandLog.map((e) => JSON.stringify(e)).join("\n") + "\n";
      await writeFile(join(this.basePath, "commands.jsonl"), jsonl, { flag: "a" });
      this.commandLog = [];
    }

    if (this.telemetryLog.length > 0) {
      const jsonl = this.telemetryLog.map((e) => JSON.stringify(e)).join("\n") + "\n";
      await writeFile(join(this.basePath, "telemetry.jsonl"), jsonl, { flag: "a" });
      this.telemetryLog = [];
    }

    if (this.commandBinChunks.length > 0) {
      const combined = concatUint8Arrays(this.commandBinChunks);
      await writeFile(join(this.basePath, "commands.binlog"), combined, { flag: "a" });
      this.commandBinChunks = [];
    }

    if (this.telemetryBinChunks.length > 0) {
      const combined = concatUint8Arrays(this.telemetryBinChunks);
      await writeFile(join(this.basePath, "telemetry.binlog"), combined, { flag: "a" });
      this.telemetryBinChunks = [];
    }
  }

  async stop(): Promise<void> {
    this.isActive = false;
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    await this.flush();

    this.metadata["endTime"] = new Date().toISOString();
    this.metadata["totalCameraFrames"] = this.cameraFrameCount;
    await writeFile(
      join(this.basePath, "metadata.json"),
      JSON.stringify(this.metadata, null, 2)
    );
  }

  getBasePath(): string {
    return this.basePath;
  }
}

function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}
