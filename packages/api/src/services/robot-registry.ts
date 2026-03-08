import type WebSocket from "ws";
import type { RobotCapabilities } from "@robocloud/shared";
import { RobotStatus } from "@robocloud/shared";

export interface RegisteredRobot {
  id: string;
  name: string;
  model: string;
  capabilities: RobotCapabilities;
  status: RobotStatus;
  agentWs: WebSocket | null;
  connectedAt: Date | null;
}

class RobotRegistryService {
  private robots: Map<string, RegisteredRobot> = new Map();

  register(
    id: string,
    name: string,
    model: string,
    capabilities: RobotCapabilities
  ): RegisteredRobot {
    const robot: RegisteredRobot = {
      id,
      name,
      model,
      capabilities,
      status: RobotStatus.OFFLINE,
      agentWs: null,
      connectedAt: null,
    };
    this.robots.set(id, robot);
    return robot;
  }

  get(id: string): RegisteredRobot | undefined {
    return this.robots.get(id);
  }

  getAll(): RegisteredRobot[] {
    return Array.from(this.robots.values());
  }

  setAgentConnection(id: string, ws: WebSocket): void {
    const robot = this.robots.get(id);
    if (robot) {
      robot.agentWs = ws;
      robot.status = RobotStatus.AVAILABLE;
      robot.connectedAt = new Date();
    }
  }

  removeAgentConnection(id: string): void {
    const robot = this.robots.get(id);
    if (robot) {
      robot.agentWs = null;
      robot.status = RobotStatus.OFFLINE;
      robot.connectedAt = null;
    }
  }

  setStatus(id: string, status: RobotStatus): void {
    const robot = this.robots.get(id);
    if (robot) {
      robot.status = status;
    }
  }

  isAvailable(id: string): boolean {
    const robot = this.robots.get(id);
    return robot !== undefined && robot.status === RobotStatus.AVAILABLE && robot.agentWs !== null;
  }
}

export const robotRegistry = new RobotRegistryService();
