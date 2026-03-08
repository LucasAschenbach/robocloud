import { Command } from "commander";
import chalk from "chalk";
import type { RobotResponse } from "@robocloud/shared";
import { getClient, handleError, printTable, statusColor } from "../util.js";

export function registerRobotCommands(program: Command): void {
  const robots = program
    .command("robots")
    .description("List and inspect robots");

  robots
    .command("list")
    .description("List all available robots")
    .action(async () => {
      try {
        const client = await getClient();
        const list = await client.listRobots();

        printTable(
          list.map((r) => ({
            id: r.id,
            name: r.name,
            model: r.model,
            status: r.status,
            joints: r.capabilities.joints.length,
            cameras: r.capabilities.cameras.length,
            mobility: r.capabilities.mobility,
          })),
          [
            { key: "id", header: "ID" },
            { key: "name", header: "NAME" },
            { key: "model", header: "MODEL" },
            { key: "status", header: "STATUS" },
            { key: "joints", header: "JOINTS", width: 6 },
            { key: "cameras", header: "CAMS", width: 4 },
            { key: "mobility", header: "MOBILITY" },
          ]
        );
      } catch (err) {
        handleError(err);
      }
    });

  robots
    .command("get <id>")
    .description("Show detailed information for a robot")
    .action(async (id: string) => {
      try {
        const client = await getClient();
        const robot = await client.getRobot(id);
        printRobotDetail(robot);
      } catch (err) {
        handleError(err);
      }
    });
}

function printRobotDetail(robot: RobotResponse): void {
  console.log(`${chalk.bold("ID:")}       ${robot.id}`);
  console.log(`${chalk.bold("Name:")}     ${robot.name}`);
  console.log(`${chalk.bold("Model:")}    ${robot.model}`);
  console.log(`${chalk.bold("Status:")}   ${statusColor(robot.status)}`);
  console.log(`${chalk.bold("Mobility:")} ${robot.capabilities.mobility}`);

  if (robot.capabilities.endEffector) {
    console.log(`${chalk.bold("End effector:")} yes`);
  }

  if (robot.capabilities.joints.length > 0) {
    console.log(`\n${chalk.bold("Joints:")}`);
    printTable(
      robot.capabilities.joints.map((j) => ({
        name: j.name,
        range: `[${j.minPosition.toFixed(2)}, ${j.maxPosition.toFixed(2)}]`,
        maxVel: j.maxVelocity.toFixed(2),
        maxTorque: j.maxTorque.toFixed(2),
      })),
      [
        { key: "name", header: "NAME" },
        { key: "range", header: "RANGE (rad)" },
        { key: "maxVel", header: "MAX VEL" },
        { key: "maxTorque", header: "MAX TORQUE" },
      ]
    );
  }

  if (robot.capabilities.cameras.length > 0) {
    console.log(`\n${chalk.bold("Cameras:")}`);
    printTable(
      robot.capabilities.cameras.map((c) => ({
        name: c.name,
        resolution: `${c.width}x${c.height}`,
        fps: c.fps,
      })),
      [
        { key: "name", header: "NAME" },
        { key: "resolution", header: "RESOLUTION" },
        { key: "fps", header: "FPS", width: 5 },
      ]
    );
  }
}
