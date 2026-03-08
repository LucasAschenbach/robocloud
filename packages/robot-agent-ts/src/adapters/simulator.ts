import type {
  Command,
  TelemetryFrame,
  RobotCapabilities,
  RobotAdapter,
} from "@robocloud/shared";
import { Simulator, Arm6DOF, Mobile2D } from "@robocloud/simulator";
import type { SimulatedRobot } from "@robocloud/simulator";

export interface SimulatorAdapterConfig {
  robotType: "arm6dof" | "mobile2d";
  robotId: string;
  robotName: string;
  tickRateHz?: number;
}

export class SimulatorAdapter implements RobotAdapter {
  readonly id: string;
  readonly name: string;
  readonly model: string;

  private simulator: Simulator;
  private robot: SimulatedRobot;
  private latestTelemetry: TelemetryFrame | null = null;

  constructor(config: SimulatorAdapterConfig) {
    this.id = config.robotId;
    this.name = config.robotName;

    this.simulator = new Simulator({ tickRateHz: config.tickRateHz ?? 100 });

    if (config.robotType === "arm6dof") {
      this.robot = new Arm6DOF(config.robotId, config.robotName);
    } else {
      this.robot = new Mobile2D(config.robotId, config.robotName);
    }

    this.model = this.robot.model;
    this.simulator.registerRobot(this.robot);
  }

  getCapabilities(): RobotCapabilities {
    return this.robot.getCapabilities();
  }

  sendCommand(cmd: Command): void {
    this.simulator.sendCommand(this.id, cmd);
  }

  getTelemetry(): TelemetryFrame {
    if (this.latestTelemetry) {
      return this.latestTelemetry;
    }
    return this.robot.getTelemetry();
  }

  async connect(): Promise<void> {
    this.simulator.onTelemetry(this.id, (frame) => {
      this.latestTelemetry = frame;
    });
    this.simulator.start();
  }

  async disconnect(): Promise<void> {
    this.simulator.stop();
    this.simulator.removeTelemetryCallback(this.id);
  }
}
