import { z } from "zod";

export const createSessionSchema = z.object({
  robotId: z.string().min(1),
  record: z.boolean().default(true),
});

export type CreateSessionPayload = z.infer<typeof createSessionSchema>;

export const sessionResponseSchema = z.object({
  id: z.string(),
  robotId: z.string(),
  userId: z.string(),
  status: z.enum(["active", "paused", "ended"]),
  record: z.boolean(),
  wsEndpoint: z.string(),
  createdAt: z.string(),
  endedAt: z.string().nullable(),
});

export type SessionResponse = z.infer<typeof sessionResponseSchema>;

export const robotResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  model: z.string(),
  status: z.enum(["available", "in_session", "offline", "maintenance"]),
  capabilities: z.object({
    joints: z.array(
      z.object({
        name: z.string(),
        minPosition: z.number(),
        maxPosition: z.number(),
        maxVelocity: z.number(),
        maxTorque: z.number(),
      })
    ),
    endEffector: z.boolean(),
    cameras: z.array(
      z.object({
        name: z.string(),
        width: z.number(),
        height: z.number(),
        fps: z.number(),
      })
    ),
    mobility: z.enum(["fixed", "wheeled", "legged"]),
  }),
});

export type RobotResponse = z.infer<typeof robotResponseSchema>;

export const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export type SignupPayload = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export type LoginPayload = z.infer<typeof loginSchema>;

export const authResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string().optional(),
  expiresAt: z.number(),
});

export type AuthResponse = z.infer<typeof authResponseSchema>;

export const apiKeyResponseSchema = z.object({
  apiKey: z.string(),
  createdAt: z.string(),
});

export type ApiKeyResponse = z.infer<typeof apiKeyResponseSchema>;

export const errorResponseSchema = z.object({
  error: z.string(),
  message: z.string(),
  statusCode: z.number(),
});

export type ErrorResponse = z.infer<typeof errorResponseSchema>;
