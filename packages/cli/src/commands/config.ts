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

          if (cfg.tokenExpiresAt) {
            const expiresAt = new Date(cfg.tokenExpiresAt * 1000);
            const nowMs = Date.now();
            const diffMs = expiresAt.getTime() - nowMs;
            if (diffMs <= 0) {
              console.log(chalk.red(`✗ Token expired at ${expiresAt.toLocaleString()} — run \`robocloud login\``));
            } else {
              const diffMins = Math.round(diffMs / 60_000);
              const diffHours = Math.floor(diffMins / 60);
              const remaining =
                diffHours >= 1
                  ? `${diffHours}h ${diffMins % 60}m`
                  : `${diffMins}m`;
              console.log(chalk.green(`✓ Authenticated`) + chalk.dim(` (expires in ${remaining})`));
            }
          } else {
            console.log(chalk.green("✓ Token stored") + chalk.dim(" (expiry unknown — may be a dev token)"));
          }
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
