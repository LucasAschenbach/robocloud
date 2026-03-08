import type { FastifyInstance } from "fastify";
import { createSessionSchema } from "@robocloud/shared";
import { authenticate, getUser } from "../services/auth.js";
import { sessionManager } from "../services/session-manager.js";
import { config } from "../config.js";

function serializeSession(session: ReturnType<typeof sessionManager.getSession> | null) {
  if (!session) return null;
  return {
    id: session.id,
    robotId: session.robotId,
    userId: session.userId,
    status: session.status,
    record: session.record,
    wsEndpoint: `ws://${config.host === "0.0.0.0" ? "localhost" : config.host}:${config.port}/sessions/${session.id}/control`,
    createdAt: session.createdAt.toISOString(),
    endedAt: session.endedAt?.toISOString() ?? null,
  };
}

export async function sessionRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", authenticate);

  app.post("/sessions", async (request, reply) => {
    const parsed = createSessionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Bad Request",
        message: parsed.error.message,
        statusCode: 400,
      });
    }

    const user = getUser(request);
    const session = sessionManager.createSession(
      parsed.data.robotId,
      user.id,
      parsed.data.record
    );

    if (!session) {
      return reply.code(409).send({
        error: "Conflict",
        message: "Robot is not available or already in a session",
        statusCode: 409,
      });
    }

    return reply.code(201).send(serializeSession(session));
  });

  app.get<{ Params: { id: string } }>("/sessions/:id", async (request, reply) => {
    const session = sessionManager.getSession(request.params.id);
    if (!session) {
      return reply.code(404).send({
        error: "Not Found",
        message: "Session not found",
        statusCode: 404,
      });
    }

    const user = getUser(request);
    if (session.userId !== user.id) {
      return reply.code(403).send({
        error: "Forbidden",
        message: "Not your session",
        statusCode: 403,
      });
    }

    return reply.send(serializeSession(session));
  });

  app.delete<{ Params: { id: string } }>("/sessions/:id", async (request, reply) => {
    const user = getUser(request);
    const session = sessionManager.getSession(request.params.id);

    if (!session) {
      return reply.code(404).send({
        error: "Not Found",
        message: "Session not found",
        statusCode: 404,
      });
    }

    if (session.userId !== user.id) {
      return reply.code(403).send({
        error: "Forbidden",
        message: "Not your session",
        statusCode: 403,
      });
    }

    const ended = sessionManager.endSession(request.params.id);
    return reply.send(serializeSession(ended ?? undefined));
  });
}
