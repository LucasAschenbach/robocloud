import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import fastifyCors from "@fastify/cors";
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

  app.get("/health", async () => ({ status: "ok", timestamp: new Date().toISOString() }));

  await app.register(authRoutes);
  await app.register(robotRoutes);
  await app.register(sessionRoutes);
  await app.register(recordingRoutes);
  await app.register(agentWsHandler);
  await app.register(controlWsHandler);

  await app.listen({ port: config.port, host: config.host });
  console.log(`[api] RoboCloud API listening on http://${config.host}:${config.port}`);
}

main().catch((err) => {
  console.error("[api] fatal:", err);
  process.exit(1);
});
