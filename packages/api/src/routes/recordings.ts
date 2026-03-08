import { createReadStream, existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, sep, normalize } from "node:path";
import type { FastifyInstance } from "fastify";
import { authenticate, getUser } from "../services/auth.js";
import { sessionManager } from "../services/session-manager.js";

export async function recordingRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", authenticate);

  app.get<{ Params: { id: string } }>(
    "/sessions/:id/recording",
    async (request, reply) => {
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

      const basePath = join(process.cwd(), "recordings", request.params.id);
      if (!existsSync(basePath)) {
        return reply.code(404).send({
          error: "Not Found",
          message: "No recording found for this session",
          statusCode: 404,
        });
      }

      try {
        const metadataPath = join(basePath, "metadata.json");
        const metadata = existsSync(metadataPath)
          ? JSON.parse(await readFile(metadataPath, "utf-8"))
          : {};

        const files = await readdir(basePath, { recursive: true });
        const fileList: string[] = [];
        for (const f of files) {
          const filePath = join(basePath, f.toString());
          const s = await stat(filePath);
          if (s.isFile()) {
            fileList.push(f.toString());
          }
        }

        return reply.send({
          sessionId: request.params.id,
          metadata,
          files: fileList,
        });
      } catch (err) {
        return reply.code(500).send({
          error: "Internal Server Error",
          message: "Failed to read recording",
          statusCode: 500,
        });
      }
    }
  );

  // Wildcard route: serves any file inside the recording directory.
  // Supports short aliases (e.g. "telemetry" → "telemetry.jsonl") as well as
  // direct relative paths returned by the info endpoint (e.g. "cameras/cam0_000001.raw").
  app.get(
    "/sessions/:id/recording/*",
    async (request, reply) => {
      const { id } = request.params as { id: string };

      const session = sessionManager.getSession(id);
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

      const streamParam = (request.params as Record<string, string>)["*"] ?? "";

      // Short aliases for backward compatibility
      const streamAliases: Record<string, string> = {
        "commands": "commands.jsonl",
        "commands.binlog": "commands.binlog",
        "telemetry": "telemetry.jsonl",
        "telemetry.binlog": "telemetry.binlog",
        "metadata": "metadata.json",
      };

      const relativePath = streamAliases[streamParam] ?? streamParam;

      // Prevent path traversal
      const basePath = join(process.cwd(), "recordings", id);
      const filePath = normalize(join(basePath, relativePath));
      if (!filePath.startsWith(basePath + sep) && filePath !== basePath) {
        return reply.code(400).send({
          error: "Bad Request",
          message: "Invalid path",
          statusCode: 400,
        });
      }

      if (!existsSync(filePath)) {
        return reply.code(404).send({
          error: "Not Found",
          message: `File not found: ${relativePath}`,
          statusCode: 404,
        });
      }

      const contentType =
        relativePath.endsWith(".json") || relativePath.endsWith(".jsonl")
          ? "application/json"
          : "application/octet-stream";

      reply.header("Content-Type", contentType);
      return reply.send(createReadStream(filePath));
    }
  );
}
