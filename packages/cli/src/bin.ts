#!/usr/bin/env node
import { Command } from "commander";
import { registerLoginCommands } from "./commands/login.js";
import { registerConfigCommands } from "./commands/config.js";
import { registerRobotCommands } from "./commands/robots.js";
import { registerSessionCommands } from "./commands/sessions.js";
import { registerControlCommand } from "./commands/control.js";
import { registerRecordingCommands } from "./commands/recordings.js";

const program = new Command();

program
  .name("robocloud")
  .description("CLI for the RoboCloud robotics platform")
  .version("0.1.0");

registerConfigCommands(program);
registerLoginCommands(program);
registerRobotCommands(program);
registerSessionCommands(program);
registerControlCommand(program);
registerRecordingCommands(program);

program.parseAsync(process.argv).catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`Fatal: ${msg}`);
  process.exit(1);
});
