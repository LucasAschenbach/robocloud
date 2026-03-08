import type { FastifyInstance } from "fastify";
import { Mobility, RobotStatus } from "@robocloud/shared";
import { authenticate, getUser } from "../services/auth.js";
import { robotRegistry } from "../services/robot-registry.js";

function mobilityToString(m: Mobility): string {
  switch (m) {
    case Mobility.FIXED: return "fixed";
    case Mobility.WHEELED: return "wheeled";
    case Mobility.LEGGED: return "legged";
    default: return "fixed";
  }
}

function statusToString(s: RobotStatus): string {
  switch (s) {
    case RobotStatus.AVAILABLE: return "available";
    case RobotStatus.IN_SESSION: return "in_session";
    case RobotStatus.OFFLINE: return "offline";
    case RobotStatus.MAINTENANCE: return "maintenance";
    default: return "offline";
  }
}

function serializeRobot(robot: ReturnType<typeof robotRegistry.get>) {
  if (!robot) return null;
  const caps = robot.capabilities;
  return {
    id: robot.id,
    name: robot.name,
    model: robot.model,
    status: statusToString(robot.status),
    capabilities: {
      joints: caps.joints.map((j) => ({
        name: j.name,
        minPosition: j.minPosition,
        maxPosition: j.maxPosition,
        maxVelocity: j.maxVelocity,
        maxTorque: j.maxTorque,
      })),
      endEffector: caps.endEffector,
      cameras: caps.cameras.map((c) => ({
        name: c.name,
        width: c.width,
        height: c.height,
        fps: c.fps,
      })),
      mobility: mobilityToString(caps.mobility),
    },
  };
}

export async function robotRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", authenticate);

  app.get("/robots", async (_request, reply) => {
    const all = robotRegistry.getAll();
    return reply.send(all.map(serializeRobot));
  });

  app.get<{ Params: { id: string } }>("/robots/:id", async (request, reply) => {
    const robot = robotRegistry.get(request.params.id);
    if (!robot) {
      return reply.code(404).send({
        error: "Not Found",
        message: `Robot ${request.params.id} not found`,
        statusCode: 404,
      });
    }
    return reply.send(serializeRobot(robot));
  });
}
