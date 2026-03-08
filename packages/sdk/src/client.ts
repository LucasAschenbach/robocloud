import type {
  AuthResponse,
  RobotResponse,
  SessionResponse,
  CreateSessionPayload,
  ErrorResponse,
} from "@robocloud/shared";
import { RoboCloudSession } from "./session.js";

export interface RoboCloudClientConfig {
  baseUrl: string;
  accessToken?: string;
  fetchTimeoutMs?: number;
}

export class RoboCloudClient {
  private baseUrl: string;
  private accessToken: string | null;
  private fetchTimeoutMs: number;

  constructor(config: RoboCloudClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.accessToken = config.accessToken ?? null;
    this.fetchTimeoutMs = config.fetchTimeoutMs ?? 10000;
  }

  async signup(email: string, password: string): Promise<AuthResponse> {
    const res = await this.fetch("/auth/signup", {
      method: "POST",
      body: { email, password },
      auth: false,
    });
    this.accessToken = res.accessToken;
    return res as AuthResponse;
  }

  async login(email: string, password: string): Promise<AuthResponse> {
    const res = await this.fetch("/auth/login", {
      method: "POST",
      body: { email, password },
      auth: false,
    });
    this.accessToken = res.accessToken;
    return res as AuthResponse;
  }

  setAccessToken(token: string): void {
    this.accessToken = token;
  }

  async listRobots(): Promise<RobotResponse[]> {
    return this.fetch("/robots");
  }

  async getRobot(id: string): Promise<RobotResponse> {
    return this.fetch(`/robots/${id}`);
  }

  async createSession(
    robotId: string,
    options: { record?: boolean } = {}
  ): Promise<RoboCloudSession> {
    const payload: CreateSessionPayload = {
      robotId,
      record: options.record ?? true,
    };

    const sessionData: SessionResponse = await this.fetch("/sessions", {
      method: "POST",
      body: payload,
    });

    const wsUrl = sessionData.wsEndpoint;
    return new RoboCloudSession(sessionData, wsUrl, this.accessToken ?? "");
  }

  async getSession(id: string): Promise<SessionResponse> {
    return this.fetch(`/sessions/${id}`);
  }

  async endSession(id: string): Promise<SessionResponse> {
    return this.fetch(`/sessions/${id}`, { method: "DELETE" });
  }

  async getRecordingInfo(sessionId: string): Promise<{
    sessionId: string;
    metadata: Record<string, unknown>;
    files: string[];
  }> {
    return this.fetch(`/sessions/${sessionId}/recording`);
  }

  async getRecordingStream(
    sessionId: string,
    stream: string
  ): Promise<ArrayBuffer> {
    const url = `${this.baseUrl}/sessions/${sessionId}/recording/${stream}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.fetchTimeoutMs);

    try {
      const response = await globalThis.fetch(url, {
        headers: this.accessToken
          ? { Authorization: `Bearer ${this.accessToken}` }
          : {},
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({})) as ErrorResponse;
        throw new Error(error.message ?? `HTTP ${response.status}`);
      }

      return response.arrayBuffer();
    } finally {
      clearTimeout(timer);
    }
  }

  private async fetch(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      auth?: boolean;
    } = {}
  ): Promise<any> {
    const { method = "GET", body, auth = true } = options;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (auth && this.accessToken) {
      headers["Authorization"] = `Bearer ${this.accessToken}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.fetchTimeoutMs);

    try {
      const response = await globalThis.fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          (data as ErrorResponse).message ?? `HTTP ${response.status}`
        );
      }

      return data;
    } finally {
      clearTimeout(timer);
    }
  }
}
