import type { FastifyInstance } from "fastify";
import { signupSchema, loginSchema } from "@robocloud/shared";
import { signup, login } from "../services/auth.js";

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/auth/signup", async (request, reply) => {
    const parsed = signupSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Bad Request",
        message: parsed.error.message,
        statusCode: 400,
      });
    }

    try {
      const result = await signup(parsed.data.email, parsed.data.password);
      return reply.code(201).send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Signup failed";
      return reply.code(400).send({
        error: "Bad Request",
        message,
        statusCode: 400,
      });
    }
  });

  app.post("/auth/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Bad Request",
        message: parsed.error.message,
        statusCode: 400,
      });
    }

    try {
      const result = await login(parsed.data.email, parsed.data.password);
      return reply.send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Login failed";
      return reply.code(401).send({
        error: "Unauthorized",
        message,
        statusCode: 401,
      });
    }
  });
}
