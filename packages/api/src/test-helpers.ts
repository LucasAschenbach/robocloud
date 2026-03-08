import Fastify, { type FastifyInstance } from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import fastifyCors from "@fastify/cors";
import { robotRoutes } from "./routes/robots.js";
import { sessionRoutes } from "./routes/sessions.js";
import { recordingRoutes } from "./routes/recordings.js";
import { agentWsHandler } from "./ws/agent-handler.js";
import { controlWsHandler } from "./ws/control-handler.js";

/**
 * Create a test API server that skips Supabase auth.
 * Injects a fake user for all authenticated routes.
 */
export async function createTestServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await app.register(fastifyCors, { origin: true });
  await app.register(fastifyWebsocket);

  app.addHook("onRequest", async (request) => {
    (request as any).user = { id: "test-user-001", email: "test@robocloud.dev" };
  });

  app.get("/health", async () => ({ status: "ok" }));

  await app.register(async (instance) => {
    instance.get("/robots", async (request, reply) => {
      const { robotRegistry } = await import("./services/robot-registry.js");
      const { Mobility, RobotStatus } = await import("@robocloud/shared");

      const mobilityToString = (m: number) => {
        switch (m) {
          case Mobility.FIXED: return "fixed";
          case Mobility.WHEELED: return "wheeled";
          case Mobility.LEGGED: return "legged";
          default: return "fixed";
        }
      };
      const statusToString = (s: number) => {
        switch (s) {
          case RobotStatus.AVAILABLE: return "available";
          case RobotStatus.IN_SESSION: return "in_session";
          case RobotStatus.OFFLINE: return "offline";
          default: return "offline";
        }
      };

      const all = robotRegistry.getAll();
      return reply.send(
        all.map((r) => ({
          id: r.id,
          name: r.name,
          model: r.model,
          status: statusToString(r.status),
          capabilities: {
            joints: r.capabilities.joints.map((j) => ({
              name: j.name,
              minPosition: j.minPosition,
              maxPosition: j.maxPosition,
              maxVelocity: j.maxVelocity,
              maxTorque: j.maxTorque,
            })),
            endEffector: r.capabilities.endEffector,
            cameras: r.capabilities.cameras.map((c) => ({
              name: c.name,
              width: c.width,
              height: c.height,
              fps: c.fps,
            })),
            mobility: mobilityToString(r.capabilities.mobility),
          },
        }))
      );
    });

    instance.post("/sessions", async (request, reply) => {
      const { createSessionSchema } = await import("@robocloud/shared");
      const { sessionManager } = await import("./services/session-manager.js");
      const parsed = createSessionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
      }
      const user = (request as any).user;
      const session = sessionManager.createSession(parsed.data.robotId, user.id, parsed.data.record);
      if (!session) {
        return reply.code(409).send({ error: "Conflict", message: "Robot not available", statusCode: 409 });
      }
      return reply.code(201).send({
        id: session.id,
        robotId: session.robotId,
        userId: session.userId,
        status: session.status,
        record: session.record,
        wsEndpoint: `ws://localhost:0/sessions/${session.id}/control`,
        createdAt: session.createdAt.toISOString(),
        endedAt: null,
      });
    });

    instance.delete<{ Params: { id: string } }>("/sessions/:id", async (request, reply) => {
      const { sessionManager } = await import("./services/session-manager.js");
      const ended = sessionManager.endSession(request.params.id);
      if (!ended) {
        return reply.code(404).send({ error: "Not Found", message: "Session not found", statusCode: 404 });
      }
      return reply.send({
        id: ended.id,
        robotId: ended.robotId,
        userId: ended.userId,
        status: ended.status,
        record: ended.record,
        wsEndpoint: "",
        createdAt: ended.createdAt.toISOString(),
        endedAt: ended.endedAt?.toISOString() ?? null,
      });
    });
  });

  await app.register(agentWsHandler);
  await app.register(controlWsHandler);

  return app;
}
