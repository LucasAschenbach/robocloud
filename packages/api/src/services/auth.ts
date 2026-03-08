import type { FastifyRequest, FastifyReply } from "fastify";
import { getSupabaseAdmin, getSupabaseAnon } from "../db/supabase.js";
import { config } from "../config.js";

export interface AuthUser {
  id: string;
  email: string;
}

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (!config.supabaseConfigured) {
    (request as FastifyRequest & { user: AuthUser }).user = {
      id: "dev-user",
      email: "dev@robocloud.local",
    };
    return;
  }

  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    reply.code(401).send({ error: "Unauthorized", message: "Missing Bearer token", statusCode: 401 });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const { data, error } = await getSupabaseAdmin().auth.getUser(token);
    if (error || !data.user) {
      reply.code(401).send({ error: "Unauthorized", message: "Invalid token", statusCode: 401 });
      return;
    }

    (request as FastifyRequest & { user: AuthUser }).user = {
      id: data.user.id,
      email: data.user.email ?? "",
    };
  } catch {
    reply.code(401).send({ error: "Unauthorized", message: "Token validation failed", statusCode: 401 });
  }
}

export function getUser(request: FastifyRequest): AuthUser {
  return (request as FastifyRequest & { user: AuthUser }).user;
}

export async function signup(
  email: string,
  password: string
): Promise<{ accessToken: string; refreshToken?: string; expiresAt: number }> {
  const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error) throw new Error(error.message);

  const loginResult = await login(email, password);
  return loginResult;
}

export async function login(
  email: string,
  password: string
): Promise<{ accessToken: string; refreshToken?: string; expiresAt: number }> {
  const { data, error } = await getSupabaseAnon().auth.signInWithPassword({
    email,
    password,
  });

  if (error) throw new Error(error.message);
  if (!data.session) throw new Error("No session returned");

  return {
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    expiresAt: data.session.expires_at ?? 0,
  };
}
