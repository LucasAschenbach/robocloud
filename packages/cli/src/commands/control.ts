import { Command } from "commander";
import chalk from "chalk";
import blessed from "blessed";
import type { TelemetryFrame } from "@robocloud/shared";
import { RoboCloudClient, type RoboCloudSession } from "@robocloud/sdk";
import { getClient, handleError } from "../util.js";
import { loadConfig } from "../config.js";

const HELP_LINES = [
  chalk.bold("Commands"),
  "",
  `  ${chalk.cyan("j <joint> <value>")}      Set a single joint (radians)  e.g. j shoulder_pan 0.5`,
  `  ${chalk.cyan("joints <j1=v1> ...")}     Set multiple joints            e.g. joints elbow=0.8 wrist_1=-0.3`,
  `  ${chalk.cyan("gripper <0-1>")}          Set gripper openness (0=closed, 1=open)`,
  `  ${chalk.cyan("help")}                   Show this help`,
  `  ${chalk.cyan("q")} / ${chalk.cyan("exit")}               Disconnect and exit`,
];

export function registerControlCommand(program: Command): void {
  program
    .command("control <sessionId>")
    .description(
      "Open an interactive real-time control session (split-pane TUI)"
    )
    .option("--end-on-exit", "Also end the session when you quit")
    .action(
      async (sessionId: string, opts: { endOnExit?: boolean }) => {
        try {
          const client = await getClient();
          const config = await loadConfig();

          process.stdout.write(chalk.dim(`Fetching session ${sessionId}…\n`));
          const sessionData = await client.getSession(sessionId);

          process.stdout.write(chalk.dim(`Connecting to WebSocket…\n`));
          const session = await createConnectedSession(
            client,
            config.accessToken!,
            sessionData
          );

          // ── Build the blessed TUI ──────────────────────────────────────
          const screen = blessed.screen({
            smartCSR: true,
            title: `RoboCloud — ${sessionId}`,
            fullUnicode: true,
            forceUnicode: true,
          });

          const telemetryBox = blessed.box({
            top: 0,
            left: 0,
            width: "100%",
            height: "60%",
            border: { type: "line" },
            label: ` Telemetry — ${sessionData.robotId} `,
            padding: { left: 1, right: 1 },
            tags: false,
            content: chalk.dim("Waiting for telemetry…"),
          });

          const logBox = blessed.log({
            top: "60%",
            left: 0,
            width: "100%",
            // Remaining height minus the 3-line input box at the bottom
            height: "40%-3",
            border: { type: "line" },
            label: " Log ",
            padding: { left: 1, right: 0 },
            scrollable: true,
            alwaysScroll: true,
            scrollback: 500,
            tags: false,
            scrollbar: {
              ch: "│",
              style: { fg: "cyan" },
            },
          });

          const inputBox = blessed.textbox({
            bottom: 0,
            left: 0,
            width: "100%",
            height: 3,
            border: { type: "line" },
            label: ` ${chalk.cyan("robocloud")} `,
            padding: { left: 1, right: 1 },
            inputOnFocus: true,
            keys: true,
            mouse: true,
          });

          screen.append(telemetryBox);
          screen.append(logBox);
          screen.append(inputBox);

          // Show help on start
          for (const line of HELP_LINES) logBox.log(line);
          logBox.log("");
          logBox.log(
            chalk.green(`✓ Connected`) +
              chalk.dim(` — session ${sessionId} | robot ${sessionData.robotId}`)
          );
          logBox.log("");

          inputBox.focus();
          screen.render();

          // ── Telemetry ─────────────────────────────────────────────────
          let frameCount = 0;

          session.onTelemetry((frame) => {
            frameCount++;
            telemetryBox.setContent(formatTelemetry(frame, frameCount));
            screen.render();
          });

          session.onDisconnect((code, reason) => {
            logBox.log(
              chalk.yellow(
                `Disconnected (code ${code}${reason ? `: ${reason}` : ""})`
              )
            );
            screen.render();
          });

          session.onError((err) => {
            logBox.log(chalk.red(`WebSocket error: ${err.message}`));
            screen.render();
          });

          // ── Command history ───────────────────────────────────────────
          const history: string[] = [];
          let historyIdx = -1;

          inputBox.key(["up"], () => {
            if (history.length === 0) return;
            historyIdx = Math.min(historyIdx + 1, history.length - 1);
            inputBox.setValue(history[history.length - 1 - historyIdx]);
            screen.render();
          });

          inputBox.key(["down"], () => {
            if (historyIdx <= 0) {
              historyIdx = -1;
              inputBox.setValue("");
            } else {
              historyIdx--;
              inputBox.setValue(history[history.length - 1 - historyIdx]);
            }
            screen.render();
          });

          // ── Helpers ───────────────────────────────────────────────────
          const log = (msg: string) => {
            logBox.log(msg);
            screen.render();
          };

          const cleanup = async () => {
            screen.destroy();
            if (session.isConnected()) {
              await session.disconnect();
            }
            if (opts.endOnExit) {
              await client.endSession(sessionId).catch(() => {});
              process.stdout.write(
                chalk.green(`✓ Session ${sessionId} ended.\n`)
              );
            }
          };

          // ── Input submission ──────────────────────────────────────────
          inputBox.on("submit", async (text: string) => {
            const trimmed = text.trim();
            historyIdx = -1;

            if (trimmed) {
              history.push(trimmed);
              logBox.log(chalk.cyan(`> ${trimmed}`));

              const result = handleControlInput(trimmed, session, log);
              if (result === "quit") {
                await cleanup();
                process.exit(0);
              }
            }

            inputBox.clearValue();
            inputBox.focus();
            screen.render();
          });

          inputBox.on("cancel", () => {
            inputBox.clearValue();
            inputBox.focus();
            screen.render();
          });

          // ── Global key bindings ───────────────────────────────────────
          screen.key(["C-c"], async () => {
            await cleanup();
            process.exit(0);
          });

          // Page up/down to scroll the log without leaving the input box
          screen.key(["pageup"], () => {
            logBox.scroll(-Math.floor((logBox.height as number) / 2));
            screen.render();
          });
          screen.key(["pagedown"], () => {
            logBox.scroll(Math.floor((logBox.height as number) / 2));
            screen.render();
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
  log: (msg: string) => void
): "quit" | "ok" {
  const parts = input.split(/\s+/);
  const cmd = parts[0].toLowerCase();

  switch (cmd) {
    case "q":
    case "quit":
    case "exit":
      return "quit";

    case "help":
      for (const line of HELP_LINES) log(line);
      break;

    case "j": {
      const joint = parts[1];
      const value = parseFloat(parts[2]);
      if (!joint || isNaN(value)) {
        log(chalk.yellow("Usage: j <joint_name> <value>  e.g. j shoulder_pan 0.5"));
        break;
      }
      try {
        session.sendJointPositions({ [joint]: value });
        log(chalk.dim(`  ← ${joint} = ${value}`));
      } catch (err) {
        log(
          chalk.red(
            `  Send failed: ${err instanceof Error ? err.message : String(err)}`
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
          log(chalk.yellow(`  Invalid pair: "${pair}". Use name=value.`));
          return "ok";
        }
        const num = parseFloat(val);
        if (isNaN(num)) {
          log(chalk.yellow(`  Non-numeric value for "${name}": ${val}`));
          return "ok";
        }
        positions[name] = num;
      }
      if (Object.keys(positions).length === 0) {
        log(chalk.yellow("  Usage: joints shoulder_pan=0.5 elbow=-0.3"));
        break;
      }
      try {
        session.sendJointPositions(positions);
        const summary = Object.entries(positions)
          .map(([k, v]) => `${k}=${v}`)
          .join(", ");
        log(chalk.dim(`  ← ${summary}`));
      } catch (err) {
        log(
          chalk.red(
            `  Send failed: ${err instanceof Error ? err.message : String(err)}`
          )
        );
      }
      break;
    }

    case "gripper": {
      const openness = parseFloat(parts[1]);
      if (isNaN(openness) || openness < 0 || openness > 1) {
        log(chalk.yellow("  Usage: gripper <0-1>  e.g. gripper 0.8"));
        break;
      }
      try {
        session.sendGripper(openness);
        log(chalk.dim(`  ← gripper = ${openness}`));
      } catch (err) {
        log(
          chalk.red(
            `  Send failed: ${err instanceof Error ? err.message : String(err)}`
          )
        );
      }
      break;
    }

    default:
      log(
        chalk.yellow(
          `  Unknown command: "${cmd}". Type "help" for available commands.`
        )
      );
  }

  return "ok";
}

function formatTelemetry(frame: TelemetryFrame, frameCount: number): string {
  const lines: string[] = [];

  if (Object.keys(frame.jointStates).length > 0) {
    lines.push(chalk.bold("Joints:"));
    for (const [name, state] of Object.entries(frame.jointStates)) {
      const padded = name.padEnd(20);
      const sign = state.position >= 0 ? " " : "";
      lines.push(`  ${padded} ${sign}${state.position.toFixed(4)} rad`);
    }
  }

  if (frame.basePose?.position) {
    const p = frame.basePose.position;
    if (lines.length > 0) lines.push("");
    lines.push(chalk.bold("Base Pose:"));
    lines.push(
      `  x=${p.x.toFixed(4)}  y=${p.y.toFixed(4)}  z=${p.z.toFixed(4)}`
    );
  }

  if (frame.cameras.length > 0) {
    if (lines.length > 0) lines.push("");
    const camList = frame.cameras
      .map((c) => `${c.cameraName} (${c.width}×${c.height})`)
      .join(", ");
    lines.push(`${chalk.bold("Cameras:")} ${camList}`);
  }

  if (lines.length > 0) lines.push("");
  lines.push(chalk.dim(`frame #${frameCount}`));

  return lines.join("\n");
}
