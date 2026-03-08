import { randomUUID } from "node:crypto";
import type WebSocket from "ws";
import { RobotStatus } from "@robocloud/shared";
import { robotRegistry } from "./robot-registry.js";

export interface ActiveSession {
  id: string;
  robotId: string;
  userId: string;
  status: "active" | "paused" | "ended";
  record: boolean;
  clientWs: WebSocket | null;
  createdAt: Date;
  endedAt: Date | null;
}

class SessionManagerService {
  private sessions: Map<string, ActiveSession> = new Map();
  private robotToSession: Map<string, string> = new Map();

  createSession(robotId: string, userId: string, record: boolean): ActiveSession | null {
    if (!robotRegistry.isAvailable(robotId)) {
      return null;
    }

    const existing = this.robotToSession.get(robotId);
    if (existing) {
      const session = this.sessions.get(existing);
      if (session && session.status === "active") {
        return null;
      }
    }

    const session: ActiveSession = {
      id: randomUUID(),
      robotId,
      userId,
      status: "active",
      record,
      clientWs: null,
      createdAt: new Date(),
      endedAt: null,
    };

    this.sessions.set(session.id, session);
    this.robotToSession.set(robotId, session.id);
    robotRegistry.setStatus(robotId, RobotStatus.IN_SESSION);

    this.persistSession(session);

    return session;
  }

  getSession(id: string): ActiveSession | undefined {
    return this.sessions.get(id);
  }

  getSessionsByUser(userId: string): ActiveSession[] {
    return Array.from(this.sessions.values()).filter((s) => s.userId === userId);
  }

  setClientWs(sessionId: string, ws: WebSocket): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== "active") return false;
    session.clientWs = ws;
    return true;
  }

  endSession(id: string): ActiveSession | null {
    const session = this.sessions.get(id);
    if (!session || session.status === "ended") return null;

    session.status = "ended";
    session.endedAt = new Date();
    session.clientWs = null;

    this.robotToSession.delete(session.robotId);
    robotRegistry.setStatus(session.robotId, RobotStatus.AVAILABLE);

    this.persistSessionEnd(session);

    return session;
  }

  getSessionForRobot(robotId: string): ActiveSession | undefined {
    const sessionId = this.robotToSession.get(robotId);
    if (!sessionId) return undefined;
    return this.sessions.get(sessionId);
  }

  private persistSession(session: ActiveSession): void {
    import("../db/drizzle.js").then(async ({ getDb, schema }) => {
      const db = getDb();
      if (!db) return;
      await db.insert(schema.sessions).values({
        id: session.id,
        robotId: session.robotId,
        userId: session.userId,
        status: session.status,
        record: session.record,
        createdAt: session.createdAt,
      });
    }).catch((err) => console.warn("[session] DB persist failed:", err));
  }

  private persistSessionEnd(session: ActiveSession): void {
    import("../db/drizzle.js").then(async ({ getDb, schema }) => {
      const db = getDb();
      if (!db) return;
      const { eq } = await import("drizzle-orm");
      await db.update(schema.sessions)
        .set({ status: session.status, endedAt: session.endedAt })
        .where(eq(schema.sessions.id, session.id));
    }).catch((err) => console.warn("[session] DB persist-end failed:", err));
  }
}

export const sessionManager = new SessionManagerService();
