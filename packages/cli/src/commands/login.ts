import { Command } from "commander";
import chalk from "chalk";
import {
  loadConfig,
  updateConfig,
  clearToken,
  type CliConfig,
} from "../config.js";
import {
  getUnauthenticatedClient,
  handleError,
  prompt,
  promptPassword,
} from "../util.js";

export function registerLoginCommands(program: Command): void {
  program
    .command("login")
    .description("Authenticate with the RoboCloud API")
    .option("-e, --email <email>", "Email address")
    .option("-p, --password <password>", "Password")
    .action(async (opts: { email?: string; password?: string }) => {
      try {
        const email = opts.email ?? (await prompt("Email: "));
        const password = opts.password ?? (await promptPassword("Password: "));

        const client = await getUnauthenticatedClient();
        const auth = await client.login(email, password);

        const config = await loadConfig();
        await updateConfig({
          ...config,
          accessToken: auth.accessToken,
          tokenExpiresAt: auth.expiresAt,
        });

        console.log(chalk.green("✓ Logged in successfully."));
      } catch (err) {
        handleError(err);
      }
    });

  program
    .command("signup")
    .description("Create a new RoboCloud account")
    .option("-e, --email <email>", "Email address")
    .option("-p, --password <password>", "Password (min 8 characters)")
    .action(async (opts: { email?: string; password?: string }) => {
      try {
        const email = opts.email ?? (await prompt("Email: "));
        const password = opts.password ?? (await promptPassword("Password: "));

        const client = await getUnauthenticatedClient();
        const auth = await client.signup(email, password);

        const config = await loadConfig();
        await updateConfig({
          ...config,
          accessToken: auth.accessToken,
          tokenExpiresAt: auth.expiresAt,
        });

        console.log(chalk.green("✓ Account created and logged in."));
      } catch (err) {
        handleError(err);
      }
    });

  program
    .command("logout")
    .description("Clear stored credentials")
    .action(async () => {
      try {
        await clearToken();
        console.log(chalk.green("✓ Logged out."));
      } catch (err) {
        handleError(err);
      }
    });
}
