import type { Command, TelemetryFrame } from "./generated/index.js";
import type { RobotCapabilities } from "./generated/index.js";

export interface RobotAdapter {
  readonly id: string;
  readonly name: string;
  readonly model: string;

  getCapabilities(): RobotCapabilities;
  sendCommand(cmd: Command): void;
  getTelemetry(): TelemetryFrame;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}
