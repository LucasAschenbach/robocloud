import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface CliConfig {
  baseUrl: string;
  accessToken?: string;
}

const DEFAULT_BASE_URL = "http://localhost:3000";

function configDir(): string {
  return join(homedir(), ".config", "robocloud");
}

function configPath(): string {
  return join(configDir(), "config.json");
}

export async function loadConfig(): Promise<CliConfig> {
  const path = configPath();
  if (!existsSync(path)) {
    return { baseUrl: DEFAULT_BASE_URL };
  }
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as CliConfig;
  } catch {
    return { baseUrl: DEFAULT_BASE_URL };
  }
}

export async function saveConfig(config: CliConfig): Promise<void> {
  await mkdir(configDir(), { recursive: true });
  await writeFile(configPath(), JSON.stringify(config, null, 2) + "\n", "utf-8");
}

export async function updateConfig(partial: Partial<CliConfig>): Promise<CliConfig> {
  const current = await loadConfig();
  const updated = { ...current, ...partial };
  await saveConfig(updated);
  return updated;
}

export async function clearToken(): Promise<void> {
  const current = await loadConfig();
  delete current.accessToken;
  await saveConfig(current);
}
