import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import fastifyCors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { config } from "./config.js";
import { authRoutes } from "./routes/auth.js";
import { robotRoutes } from "./routes/robots.js";
import { sessionRoutes } from "./routes/sessions.js";
import { recordingRoutes } from "./routes/recordings.js";
import { agentWsHandler } from "./ws/agent-handler.js";
import { controlWsHandler } from "./ws/control-handler.js";

async function main(): Promise<void> {
  const app = Fastify({
    logger: {
      level: "info",
      transport: {
        target: "pino-pretty",
        options: { colorize: true },
      },
    },
  });

  await app.register(fastifyCors, { origin: true });
  await app.register(fastifyWebsocket);
  await app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
    allowList: (request) => {
      const url = request.url;
      return (
        url.includes("/agent") ||
        url.includes("/control") ||
        url.includes("/recording/")  // bulk file downloads; not API calls
      );
    },
  });

  app.get("/health", async () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
    supabaseConfigured: config.supabaseConfigured,
  }));

  await app.register(authRoutes);
  await app.register(robotRoutes);
  await app.register(sessionRoutes);
  await app.register(recordingRoutes);
  await app.register(agentWsHandler);
  await app.register(controlWsHandler);

  await app.listen({ port: config.port, host: config.host });

  const baseUrl = config.publicUrl || `http://${config.host === "0.0.0.0" ? "localhost" : config.host}:${config.port}`;
  console.log(`[api] RoboCloud API listening on ${baseUrl}`);

  if (!config.supabaseConfigured) {
    console.log("[api] WARNING: Supabase not configured — auth disabled, all routes open (dev mode)");
  }
  if (!config.robotAgentSecret) {
    console.log("[api] WARNING: ROBOT_AGENT_SECRET not set — any agent can connect");
  }
}

main().catch((err) => {
  console.error("[api] fatal:", err);
  process.exit(1);
});
