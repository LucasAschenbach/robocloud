import type { Command, TelemetryFrame } from "@robocloud/shared";
import type { SimulatedRobot, SimulatorConfig } from "./types.js";
import { DEFAULT_SIMULATOR_CONFIG } from "./types.js";

export class Simulator {
  private robots: Map<string, SimulatedRobot> = new Map();
  private config: SimulatorConfig;
  private timer: ReturnType<typeof setInterval> | null = null;
  private telemetryCallbacks: Map<string, (frame: TelemetryFrame) => void> = new Map();

  constructor(config: Partial<SimulatorConfig> = {}) {
    this.config = { ...DEFAULT_SIMULATOR_CONFIG, ...config };
  }

  registerRobot(robot: SimulatedRobot): void {
    this.robots.set(robot.id, robot);
  }

  unregisterRobot(id: string): void {
    this.robots.delete(id);
    this.telemetryCallbacks.delete(id);
  }

  getRobot(id: string): SimulatedRobot | undefined {
    return this.robots.get(id);
  }

  getAllRobots(): SimulatedRobot[] {
    return Array.from(this.robots.values());
  }

  sendCommand(robotId: string, cmd: Command): void {
    const robot = this.robots.get(robotId);
    if (robot) {
      robot.applyCommand(cmd);
    }
  }

  onTelemetry(robotId: string, callback: (frame: TelemetryFrame) => void): void {
    this.telemetryCallbacks.set(robotId, callback);
  }

  removeTelemetryCallback(robotId: string): void {
    this.telemetryCallbacks.delete(robotId);
  }

  start(): void {
    if (this.timer) return;

    const dtSeconds = 1 / this.config.tickRateHz;
    const intervalMs = dtSeconds * 1000;

    this.timer = setInterval(() => {
      for (const [id, robot] of this.robots) {
        robot.step(dtSeconds);
        const cb = this.telemetryCallbacks.get(id);
        if (cb) {
          cb(robot.getTelemetry());
        }
      }
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  isRunning(): boolean {
    return this.timer !== null;
  }
}
