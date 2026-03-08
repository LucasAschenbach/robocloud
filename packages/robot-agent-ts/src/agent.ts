import { config as loadDotenv } from "dotenv";
import { resolve, dirname } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __agentDir = dirname(fileURLToPath(import.meta.url));
function findEnvFile(): string | undefined {
  let dir = resolve(__agentDir);
  for (let i = 0; i < 10; i++) {
    const candidate = resolve(dir, ".env");
    if (existsSync(candidate)) return candidate;
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}
const envPath = findEnvFile();
if (envPath) loadDotenv({ path: envPath });

import { RobotAgentProcess } from "./robot-agent.js";
import { SimulatorAdapter } from "./adapters/simulator.js";

async function main(): Promise<void> {
  const serverUrl = process.env["ROBOT_AGENT_WS_URL"] ?? "ws://localhost:3000";
  const robotType = (process.env["ROBOT_TYPE"] ?? "arm6dof") as "arm6dof" | "mobile2d";
  const robotId = process.env["ROBOT_ID"] ?? `sim-${robotType}-001`;
  const robotName = process.env["ROBOT_NAME"] ?? `Simulated ${robotType}`;
  const agentSecret = process.env["ROBOT_AGENT_SECRET"] ?? "";

  const adapter = new SimulatorAdapter({
    robotType,
    robotId,
    robotName,
    tickRateHz: 100,
  });

  const agent = new RobotAgentProcess({
    serverUrl,
    adapter,
    agentSecret,
    telemetryRateHz: 50,
  });

  process.on("SIGINT", async () => {
    console.log("[agent] shutting down...");
    await agent.stop();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.log("[agent] shutting down...");
    await agent.stop();
    process.exit(0);
  });

  await agent.start();
  console.log(`[agent] robot ${robotId} (${robotType}) ready`);
}

main().catch((err) => {
  console.error("[agent] fatal:", err);
  process.exit(1);
});
