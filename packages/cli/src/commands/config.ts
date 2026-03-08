import { Command } from "commander";
import chalk from "chalk";
import { loadConfig, updateConfig } from "../config.js";
import { handleError } from "../util.js";

export function registerConfigCommands(program: Command): void {
  const config = program
    .command("config")
    .description("Manage CLI configuration");

  config
    .command("show")
    .description("Show current configuration")
    .action(async () => {
      try {
        const cfg = await loadConfig();
        console.log(`${chalk.bold("Base URL:")}     ${cfg.baseUrl}`);
        if (cfg.accessToken) {
          const preview = cfg.accessToken.slice(0, 12) + "…";
          console.log(`${chalk.bold("Access token:")} ${chalk.dim(preview)}`);
          console.log(chalk.green("✓ Authenticated"));
        } else {
          console.log(`${chalk.bold("Access token:")} ${chalk.dim("(none)")}`);
          console.log(chalk.yellow("Not authenticated. Run `robocloud login`."));
        }
      } catch (err) {
        handleError(err);
      }
    });

  config
    .command("set-url <url>")
    .description("Set the API base URL")
    .action(async (url: string) => {
      try {
        await updateConfig({ baseUrl: url });
        console.log(chalk.green(`✓ Base URL set to ${url}`));
      } catch (err) {
        handleError(err);
      }
    });

  config
    .command("set-token <token>")
    .description(
      "Manually set an access token (useful in dev mode when Supabase auth is disabled)"
    )
    .action(async (token: string) => {
      try {
        await updateConfig({ accessToken: token });
        console.log(chalk.green("✓ Access token saved."));
        console.log(
          chalk.dim(
            "Note: when the API has no Supabase configured it accepts any token."
          )
        );
      } catch (err) {
        handleError(err);
      }
    });
}
