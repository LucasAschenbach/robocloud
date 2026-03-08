import type { FastifyInstance, FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import { fromBinary, toBinary, create } from "@bufbuild/protobuf";
import { EnvelopeSchema, SessionControlSchema, SessionStartSchema, SessionStopSchema } from "@robocloud/shared";
import { sessionManager } from "../services/session-manager.js";
import { robotRegistry } from "../services/robot-registry.js";
import { SessionRecorder } from "../recorder/session-recorder.js";
import { config } from "../config.js";

const sessionRecorders: Map<string, SessionRecorder> = new Map();

function authenticateWsSync(request: FastifyRequest): string | null {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const token = url.searchParams.get("token")
    ?? (request.headers.authorization as string | undefined)?.replace("Bearer ", "");

  if (!config.supabaseConfigured) {
    return "dev-user";
  }

  if (!token) return null;
  return token;
}

async function validateTokenWithSupabase(token: string): Promise<string | null> {
  try {
    const { getSupabaseAdmin } = await import("../db/supabase.js");
    const { data, error } = await getSupabaseAdmin().auth.getUser(token);
    if (error || !data.user) return null;
    return data.user.id;
  } catch {
    return null;
  }
}

export async function controlWsHandler(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { sessionId: string } }>(
    "/sessions/:sessionId/control",
    { websocket: true },
    (socket: WebSocket, request: FastifyRequest) => {
      const sessionId = (request.params as { sessionId: string }).sessionId;
      const session = sessionManager.getSession(sessionId);

      if (!session || session.status !== "active") {
        socket.close(4004, "Session not found or not active");
        return;
      }

      const quickAuth = authenticateWsSync(request);

      if (config.supabaseConfigured) {
        if (!quickAuth) {
          socket.close(4001, "Unauthorized — missing token");
          return;
        }
        validateTokenWithSupabase(quickAuth).then((userId) => {
          if (!userId) {
            socket.close(4001, "Unauthorized — invalid token");
            return;
          }
          if (session.userId !== userId) {
            socket.close(4003, "Session belongs to another user");
            return;
          }
          setupControlBridge(socket, session, sessionId);
        }).catch(() => {
          socket.close(4001, "Unauthorized — token validation failed");
        });
      } else {
        setupControlBridge(socket, session, sessionId);
      }
    }
  );
}

function setupControlBridge(
  socket: WebSocket,
  session: NonNullable<ReturnType<typeof sessionManager.getSession>>,
  sessionId: string
): void {
  const robot = robotRegistry.get(session.robotId);
  if (!robot?.agentWs || robot.agentWs.readyState !== 1) {
    socket.close(4003, "Robot agent not connected");
    return;
  }

  sessionManager.setClientWs(sessionId, socket);
  console.log(`[ws] client connected to session ${sessionId}`);

  let recorder: SessionRecorder | null = null;
  if (session.record) {
    recorder = new SessionRecorder(sessionId, session.robotId, robot.model);
    sessionRecorders.set(sessionId, recorder);
    recorder.start().catch(console.error);
  }

  const startEnvelope = create(EnvelopeSchema, {
    sequence: 0n,
    timestampUs: BigInt(Math.floor(performance.now() * 1000)),
    sessionId,
    payload: {
      case: "sessionControl",
      value: create(SessionControlSchema, {
        control: {
          case: "start",
          value: create(SessionStartSchema, {
            robotId: session.robotId,
            record: session.record,
          }),
        },
      }),
    },
  });
  robot.agentWs.send(toBinary(EnvelopeSchema, startEnvelope));

  socket.on("message", (data: Buffer | ArrayBuffer) => {
    if (!robot.agentWs || robot.agentWs.readyState !== 1) return;

    const bytes = data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : Buffer.isBuffer(data)
        ? new Uint8Array(data)
        : new Uint8Array(0);

    robot.agentWs.send(bytes);

    if (recorder) {
      recorder.recordRawFrame(bytes, "command");
    }
  });

  const telemetryForwarder = (data: Buffer | ArrayBuffer) => {
    if (socket.readyState === 1) {
      socket.send(data);
    }

    const bytes = data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : Buffer.isBuffer(data)
        ? new Uint8Array(data)
        : new Uint8Array(0);

    if (recorder) {
      recorder.recordRawFrame(bytes, "telemetry");
    }
  };
  robot.agentWs.on("message", telemetryForwarder);

  const cleanup = () => {
    robot.agentWs?.removeListener("message", telemetryForwarder);
    sessionManager.setClientWs(sessionId, null as any);

    if (recorder) {
      recorder.stop().catch(console.error);
      sessionRecorders.delete(sessionId);
    }

    const stopEnvelope = create(EnvelopeSchema, {
      sequence: 0n,
      timestampUs: BigInt(Math.floor(performance.now() * 1000)),
      sessionId,
      payload: {
        case: "sessionControl",
        value: create(SessionControlSchema, {
          control: {
            case: "stop",
            value: create(SessionStopSchema, {}),
          },
        }),
      },
    });

    if (robot.agentWs && robot.agentWs.readyState === 1) {
      robot.agentWs.send(toBinary(EnvelopeSchema, stopEnvelope));
    }
  };

  socket.on("close", () => {
    console.log(`[ws] client disconnected from session ${sessionId}`);
    cleanup();
  });

  socket.on("error", (err: Error) => {
    console.error(`[ws] control error (${sessionId}):`, err.message);
    cleanup();
  });
}

export function getRecorder(sessionId: string): SessionRecorder | undefined {
  return sessionRecorders.get(sessionId);
}
