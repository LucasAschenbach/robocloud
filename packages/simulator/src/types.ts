import type { Command, TelemetryFrame, RobotCapabilities } from "@robocloud/shared";

export interface SimulatedRobot {
  readonly id: string;
  readonly name: string;
  readonly model: string;

  getCapabilities(): RobotCapabilities;
  applyCommand(cmd: Command): void;
  step(dtSeconds: number): void;
  getTelemetry(): TelemetryFrame;
  reset(): void;
}

export interface SimulatorConfig {
  tickRateHz: number;
}

export const DEFAULT_SIMULATOR_CONFIG: SimulatorConfig = {
  tickRateHz: 100,
};
