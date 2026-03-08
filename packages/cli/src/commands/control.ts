import { Command } from "commander";
import chalk from "chalk";
import { createInterface } from "node:readline";
import type { TelemetryFrame } from "@robocloud/shared";
import { RoboCloudClient, type RoboCloudSession } from "@robocloud/sdk";
import { getClient, handleError } from "../util.js";
import { loadConfig } from "../config.js";

const HELP_TEXT = `
${chalk.bold("Interactive control REPL")}

Commands:
  ${chalk.cyan("j <joint> <value>")}      Set a single joint position (radians)
                         e.g. j shoulder_pan 0.5
  ${chalk.cyan("joints <j1=v1> ...")}     Set multiple joints at once
                         e.g. joints shoulder_pan=0.5 elbow=-0.3
  ${chalk.cyan("gripper <0-1>")}          Set gripper openness (0 = closed, 1 = open)
  ${chalk.cyan("telemetry")}              Toggle live telemetry display
  ${chalk.cyan("help")}                   Show this help
  ${chalk.cyan("q")} or ${chalk.cyan("exit")}             Disconnect and exit
`;

export function registerControlCommand(program: Command): void {
  program
    .command("control <sessionId>")
    .description(
      "Open an interactive real-time control session (WebSocket REPL)"
    )
    .option("--end-on-exit", "Also end the session when you quit")
    .action(
      async (sessionId: string, opts: { endOnExit?: boolean }) => {
        try {
          const client = await getClient();
          const config = await loadConfig();

          console.log(chalk.dim(`Fetching session ${sessionId}…`));
          const sessionData = await client.getSession(sessionId);

          console.log(chalk.dim(`Connecting to WebSocket…`));
          const session = await createConnectedSession(
            client,
            config.accessToken!,
            sessionData
          );

          console.log(chalk.green(`✓ Connected to session ${sessionId}`));
          console.log(
            chalk.dim(
              `Robot: ${sessionData.robotId} | Status: ${sessionData.status}`
            )
          );
          console.log(HELP_TEXT);

          let showTelemetry = true;
          let lastTelemetry: TelemetryFrame | null = null;
          let telemetryTimer: ReturnType<typeof setInterval> | null = null;

          // Throttle telemetry display to ~2Hz
          session.onTelemetry((frame) => {
            lastTelemetry = frame;
          });

          telemetryTimer = setInterval(() => {
            if (showTelemetry && lastTelemetry) {
              printTelemetry(lastTelemetry);
            }
          }, 500);

          session.onDisconnect((code, reason) => {
            if (telemetryTimer) clearInterval(telemetryTimer);
            console.log(
              chalk.yellow(
                `\nDisconnected (code ${code}${reason ? `: ${reason}` : ""})`
              )
            );
            rl.close();
          });

          session.onError((err) => {
            console.error(chalk.red(`\nWebSocket error: ${err.message}`));
          });

          const rl = createInterface({
            input: process.stdin,
            output: process.stdout,
            prompt: chalk.cyan("robocloud> "),
          });

          rl.prompt();

          rl.on("line", async (line: string) => {
            const trimmed = line.trim();
            if (!trimmed) {
              rl.prompt();
              return;
            }

            const handled = handleControlInput(
              trimmed,
              session,
              showTelemetry,
              (val) => {
                showTelemetry = val;
              }
            );

            if (handled === "quit") {
              if (telemetryTimer) clearInterval(telemetryTimer);
              await session.disconnect();
              if (opts.endOnExit) {
                await client.endSession(sessionId).catch(() => {});
                console.log(chalk.green(`✓ Session ${sessionId} ended.`));
              }
              rl.close();
              process.exit(0);
            }

            rl.prompt();
          });

          rl.on("close", async () => {
            if (telemetryTimer) clearInterval(telemetryTimer);
            if (session.isConnected()) {
              await session.disconnect();
              if (opts.endOnExit) {
                await client.endSession(sessionId).catch(() => {});
                console.log(chalk.green(`✓ Session ${sessionId} ended.`));
              }
            }
            process.exit(0);
          });

          // Handle Ctrl+C
          process.on("SIGINT", async () => {
            console.log("\nInterrupted.");
            if (telemetryTimer) clearInterval(telemetryTimer);
            if (session.isConnected()) {
              await session.disconnect();
            }
            if (opts.endOnExit) {
              await client.endSession(sessionId).catch(() => {});
            }
            process.exit(0);
          });
        } catch (err) {
          handleError(err);
        }
      }
    );
}

async function createConnectedSession(
  client: RoboCloudClient,
  accessToken: string,
  sessionData: import("@robocloud/shared").SessionResponse
): Promise<RoboCloudSession> {
  // createSession does an HTTP POST, but we already have the session.
  // Instead we reconstruct a RoboCloudSession from the existing session data
  // by using the SDK's internal path. The SDK only exposes createSession, so
  // we call getSession to get the wsEndpoint and build the session manually.
  const { RoboCloudSession } = await import("@robocloud/sdk");
  const session = new RoboCloudSession(
    sessionData,
    sessionData.wsEndpoint,
    accessToken
  );
  await session.connect({ timeoutMs: 10000 });
  return session;
}

function handleControlInput(
  input: string,
  session: RoboCloudSession,
  showTelemetry: boolean,
  setShowTelemetry: (val: boolean) => void
): "quit" | "ok" {
  const parts = input.split(/\s+/);
  const cmd = parts[0].toLowerCase();

  switch (cmd) {
    case "q":
    case "quit":
    case "exit":
      return "quit";

    case "help":
      console.log(HELP_TEXT);
      break;

    case "telemetry":
      setShowTelemetry(!showTelemetry);
      console.log(
        showTelemetry
          ? chalk.dim("Telemetry display off.")
          : chalk.dim("Telemetry display on.")
      );
      break;

    case "j": {
      const joint = parts[1];
      const value = parseFloat(parts[2]);
      if (!joint || isNaN(value)) {
        console.log(
          chalk.yellow("Usage: j <joint_name> <value>  e.g. j shoulder_pan 0.5")
        );
        break;
      }
      try {
        session.sendJointPositions({ [joint]: value });
        console.log(chalk.dim(`→ ${joint} = ${value}`));
      } catch (err) {
        console.log(
          chalk.red(
            `Send failed: ${err instanceof Error ? err.message : String(err)}`
          )
        );
      }
      break;
    }

    case "joints": {
      const positions: Record<string, number> = {};
      for (const pair of parts.slice(1)) {
        const [name, val] = pair.split("=");
        if (!name || val === undefined) {
          console.log(chalk.yellow(`Invalid pair: "${pair}". Use name=value.`));
          return "ok";
        }
        const num = parseFloat(val);
        if (isNaN(num)) {
          console.log(chalk.yellow(`Non-numeric value for "${name}": ${val}`));
          return "ok";
        }
        positions[name] = num;
      }
      if (Object.keys(positions).length === 0) {
        console.log(
          chalk.yellow(
            "Usage: joints shoulder_pan=0.5 elbow=-0.3"
          )
        );
        break;
      }
      try {
        session.sendJointPositions(positions);
        const summary = Object.entries(positions)
          .map(([k, v]) => `${k}=${v}`)
          .join(", ");
        console.log(chalk.dim(`→ ${summary}`));
      } catch (err) {
        console.log(
          chalk.red(
            `Send failed: ${err instanceof Error ? err.message : String(err)}`
          )
        );
      }
      break;
    }

    case "gripper": {
      const openness = parseFloat(parts[1]);
      if (isNaN(openness) || openness < 0 || openness > 1) {
        console.log(chalk.yellow("Usage: gripper <0-1>  e.g. gripper 0.8"));
        break;
      }
      try {
        session.sendGripper(openness);
        console.log(chalk.dim(`→ gripper = ${openness}`));
      } catch (err) {
        console.log(
          chalk.red(
            `Send failed: ${err instanceof Error ? err.message : String(err)}`
          )
        );
      }
      break;
    }

    default:
      console.log(
        chalk.yellow(
          `Unknown command: "${cmd}". Type "help" for available commands.`
        )
      );
  }

  return "ok";
}

function printTelemetry(frame: TelemetryFrame): void {
  const lines: string[] = [];

  if (Object.keys(frame.jointStates).length > 0) {
    const joints = Object.entries(frame.jointStates)
      .map(([k, v]) => `${k}=${v.position.toFixed(3)}`)
      .join("  ");
    lines.push(`${chalk.bold("Joints:")} ${joints}`);
  }

  if (frame.basePose?.position) {
    const p = frame.basePose.position;
    lines.push(
      `${chalk.bold("Pose:")} x=${p.x.toFixed(3)} y=${p.y.toFixed(3)} z=${p.z.toFixed(3)}`
    );
  }

  if (frame.cameras.length > 0) {
    lines.push(
      `${chalk.bold("Cameras:")} ${frame.cameras.map((c) => `${c.cameraName}(${c.width}x${c.height})`).join(", ")}`
    );
  }

  if (lines.length > 0) {
    // Move cursor up to overwrite previous telemetry output
    process.stdout.write(
      `\r${chalk.dim("[")}${chalk.cyan("telemetry")}${chalk.dim("]")} ${lines.join(" | ")}\n`
    );
  }
}
