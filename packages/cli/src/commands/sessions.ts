import { Command } from "commander";
import chalk from "chalk";
import type { SessionResponse } from "@robocloud/shared";
import { getClient, handleError, statusColor } from "../util.js";

export function registerSessionCommands(program: Command): void {
  const sessions = program
    .command("sessions")
    .description("Manage robot sessions");

  sessions
    .command("create <robotId>")
    .description("Create a new session for a robot")
    .option("--no-record", "Disable recording for this session")
    .action(async (robotId: string, opts: { record: boolean }) => {
      try {
        const client = await getClient();
        const session = await client.createSession(robotId, {
          record: opts.record,
        });
        console.log(chalk.green("✓ Session created."));
        printSession(session.data);
      } catch (err) {
        handleError(err);
      }
    });

  sessions
    .command("get <id>")
    .description("Get session details")
    .action(async (id: string) => {
      try {
        const client = await getClient();
        const session = await client.getSession(id);
        printSession(session);
      } catch (err) {
        handleError(err);
      }
    });

  sessions
    .command("end <id>")
    .description("End an active session")
    .action(async (id: string) => {
      try {
        const client = await getClient();
        await client.endSession(id);
        console.log(chalk.green(`✓ Session ${id} ended.`));
      } catch (err) {
        handleError(err);
      }
    });
}

function printSession(s: SessionResponse): void {
  console.log(`${chalk.bold("Session ID:")} ${s.id}`);
  console.log(`${chalk.bold("Robot ID:")}   ${s.robotId}`);
  console.log(`${chalk.bold("Status:")}     ${statusColor(s.status)}`);
  console.log(`${chalk.bold("Recording:")}  ${s.record ? chalk.green("yes") : chalk.dim("no")}`);
  console.log(`${chalk.bold("Created:")}    ${new Date(s.createdAt).toLocaleString()}`);
  if (s.endedAt) {
    console.log(`${chalk.bold("Ended:")}      ${new Date(s.endedAt).toLocaleString()}`);
  }
  console.log(`${chalk.bold("Control WS:")} ${chalk.dim(s.wsEndpoint)}`);
}
