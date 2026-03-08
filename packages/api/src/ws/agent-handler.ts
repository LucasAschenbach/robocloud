import type { FastifyInstance, FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import {
  RobotCapabilitiesSchema,
  JointSpecSchema,
  CameraSpecSchema,
  Mobility,
} from "@robocloud/shared";
import { create } from "@bufbuild/protobuf";
import { robotRegistry } from "../services/robot-registry.js";
import { sessionManager } from "../services/session-manager.js";
import { config } from "../config.js";

interface RegistrationMessage {
  type: "register";
  robot: {
    id: string;
    name: string;
    model: string;
    capabilities: {
      joints: Array<{ name: string; minPosition: number; maxPosition: number; maxVelocity: number; maxTorque: number }>;
      endEffector: boolean;
      cameras: Array<{ name: string; width: number; height: number; fps: number }>;
      mobility: number;
    };
  };
}

function isRegistrationMessage(data: unknown): data is RegistrationMessage {
  return typeof data === "object" && data !== null && (data as any).type === "register" && (data as any).robot !== undefined;
}

export async function agentWsHandler(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { robotId: string } }>(
    "/robots/:robotId/agent",
    { websocket: true },
    (socket: WebSocket, request: FastifyRequest) => {
      if (config.robotAgentSecret) {
        const url = new URL(request.url, `http://${request.headers.host}`);
        const provided = url.searchParams.get("secret") ?? request.headers["x-agent-secret"] as string | undefined;
        if (provided !== config.robotAgentSecret) {
          console.warn(`[ws] agent rejected: invalid secret for ${(request.params as any).robotId}`);
          socket.close(4001, "Invalid agent secret");
          return;
        }
      }

      const robotId = (request.params as { robotId: string }).robotId;
      console.log(`[ws] robot agent connected: ${robotId}`);

      let registered = false;

      socket.on("message", (data: Buffer | ArrayBuffer) => {
        if (!registered) {
          try {
            const text = Buffer.isBuffer(data) ? data.toString("utf-8") : new TextDecoder().decode(data);
            const parsed = JSON.parse(text);
            if (isRegistrationMessage(parsed)) {
              const caps = parsed.robot.capabilities;
              const protoCaps = create(RobotCapabilitiesSchema, {
                joints: caps.joints.map((j) => create(JointSpecSchema, { name: j.name, minPosition: j.minPosition, maxPosition: j.maxPosition, maxVelocity: j.maxVelocity, maxTorque: j.maxTorque })),
                endEffector: caps.endEffector,
                cameras: caps.cameras.map((c) => create(CameraSpecSchema, { name: c.name, width: c.width, height: c.height, fps: c.fps })),
                mobility: caps.mobility as Mobility,
              });
              const existing = robotRegistry.get(robotId);
              if (!existing) {
                robotRegistry.register(robotId, parsed.robot.name, parsed.robot.model, protoCaps);
              } else {
                existing.name = parsed.robot.name;
                existing.model = parsed.robot.model;
                existing.capabilities = protoCaps;
              }
              robotRegistry.setAgentConnection(robotId, socket);
              registered = true;
              console.log(`[ws] robot ${robotId} registered: ${parsed.robot.model}`);
              return;
            }
          } catch { /* Not JSON — fall through to binary handling */ }
        }

        const session = sessionManager.getSessionForRobot(robotId);
        if (session?.clientWs && (session.clientWs as unknown as WebSocket).readyState === 1) {
          (session.clientWs as unknown as WebSocket).send(data);
        }
      });

      socket.on("close", () => {
        console.log(`[ws] robot agent disconnected: ${robotId}`);
        robotRegistry.removeAgentConnection(robotId);
      });

      socket.on("error", (err: Error) => {
        console.error(`[ws] agent error (${robotId}):`, err.message);
      });
    }
  );
}
