import chalk from "chalk";
import { createInterface } from "node:readline";
import { RoboCloudClient } from "@robocloud/sdk";
import { loadConfig } from "./config.js";

export async function getClient(): Promise<RoboCloudClient> {
  const config = await loadConfig();
  if (!config.accessToken) {
    console.error(chalk.red("Not authenticated. Run `robocloud login` first."));
    process.exit(1);
  }
  return new RoboCloudClient({
    baseUrl: config.baseUrl,
    accessToken: config.accessToken,
  });
}

export async function getUnauthenticatedClient(): Promise<RoboCloudClient> {
  const config = await loadConfig();
  return new RoboCloudClient({ baseUrl: config.baseUrl });
}

export async function handleError(err: unknown): Promise<never> {
  if (err instanceof TypeError && err.message === "fetch failed") {
    // Unwrap the underlying cause (typically ECONNREFUSED)
    const cause = (err as TypeError & { cause?: Error }).cause;
    const causeMsg = cause?.message ?? "";
    const config = await loadConfig();
    console.error(chalk.red("Error: Cannot reach the API server."));
    console.error(chalk.dim(`  URL:   ${config.baseUrl}`));
    if (causeMsg) console.error(chalk.dim(`  Cause: ${causeMsg}`));
    console.error(
      chalk.yellow(
        "\nStart the server with:  cd packages/api && pnpm dev"
      )
    );
    process.exit(1);
  }

  const msg = err instanceof Error ? err.message : String(err);

  // 501 means auth is disabled (no Supabase configured) — give a dev-mode hint
  if (msg.includes("Supabase is not configured") || msg.includes("Auth is disabled")) {
    console.error(chalk.red(`Error: ${msg}`));
    console.error(
      chalk.yellow(
        "\nDev mode hint: skip login and set a dummy token instead:\n" +
        "  robocloud config set-token dev-token"
      )
    );
    process.exit(1);
  }

  console.error(chalk.red(`Error: ${msg}`));
  process.exit(1);
}

export function printTable(
  rows: Record<string, unknown>[],
  columns: { key: string; header: string; width?: number }[]
): void {
  if (rows.length === 0) {
    console.log(chalk.dim("No results."));
    return;
  }

  const widths = columns.map((col) => {
    const maxData = Math.max(...rows.map((r) => String(r[col.key] ?? "").length));
    return col.width ?? Math.max(col.header.length, maxData);
  });

  const header = columns
    .map((col, i) => col.header.padEnd(widths[i]))
    .join("  ");
  const divider = widths.map((w) => "─".repeat(w)).join("  ");

  console.log(chalk.bold(header));
  console.log(chalk.dim(divider));
  for (const row of rows) {
    const line = columns
      .map((col, i) => String(row[col.key] ?? "").padEnd(widths[i]))
      .join("  ");
    console.log(line);
  }
}

export async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

export async function promptPassword(question: string): Promise<string> {
  process.stdout.write(question);
  process.stdin.setRawMode?.(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf-8");

  return new Promise((resolve) => {
    let password = "";
    const onData = (char: string) => {
      if (char === "\r" || char === "\n") {
        process.stdin.setRawMode?.(false);
        process.stdin.pause();
        process.stdin.removeListener("data", onData);
        process.stdout.write("\n");
        resolve(password);
      } else if (char === "\u0003") {
        // Ctrl+C
        process.stdout.write("\n");
        process.exit(1);
      } else if (char === "\u007f") {
        // Backspace
        password = password.slice(0, -1);
      } else {
        password += char;
      }
    };
    process.stdin.on("data", onData);
  });
}

export function statusColor(status: string): string {
  switch (status) {
    case "available":
      return chalk.green(status);
    case "in_session":
      return chalk.yellow(status);
    case "offline":
    case "maintenance":
      return chalk.red(status);
    case "active":
      return chalk.green(status);
    case "ended":
      return chalk.dim(status);
    case "paused":
      return chalk.yellow(status);
    default:
      return status;
  }
}
