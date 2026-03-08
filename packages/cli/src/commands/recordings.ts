import { Command } from "commander";
import chalk from "chalk";
import { writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { getClient, handleError } from "../util.js";

export function registerRecordingCommands(program: Command): void {
  const recordings = program
    .command("recordings")
    .description("Access session recordings");

  recordings
    .command("info <sessionId>")
    .description("Show recording metadata and available files")
    .action(async (sessionId: string) => {
      try {
        const client = await getClient();
        const info = await client.getRecordingInfo(sessionId);

        console.log(`${chalk.bold("Session ID:")} ${info.sessionId}`);

        if (Object.keys(info.metadata).length > 0) {
          console.log(`\n${chalk.bold("Metadata:")}`);
          for (const [key, val] of Object.entries(info.metadata)) {
            const valStr =
              typeof val === "object"
                ? JSON.stringify(val)
                : String(val);
            console.log(`  ${chalk.dim(key + ":")} ${valStr}`);
          }
        }

        if (info.files.length > 0) {
          console.log(`\n${chalk.bold("Available streams:")}`);
          for (const file of info.files) {
            console.log(`  ${chalk.cyan(file)}`);
          }
          console.log(
            chalk.dim(
              `\nDownload with: robocloud recordings download ${sessionId} --stream <name>`
            )
          );
        } else {
          console.log(chalk.dim("No recording files available."));
        }
      } catch (err) {
        handleError(err);
      }
    });

  recordings
    .command("download <sessionId>")
    .description("Download recording streams to disk")
    .option(
      "-s, --stream <name>",
      "File to download (e.g. telemetry, commands, cameras/cam0_000001.raw). Omit to download all."
    )
    .option(
      "-o, --output <dir>",
      "Output directory",
      `./recordings/<sessionId>`
    )
    .action(
      async (
        sessionId: string,
        opts: { stream?: string; output: string }
      ) => {
        try {
          const client = await getClient();
          const outDir = opts.output.replace("<sessionId>", sessionId);

          let streams: string[];
          if (opts.stream) {
            streams = [opts.stream];
          } else {
            // Fetch info to get available streams
            const info = await client.getRecordingInfo(sessionId);
            streams = info.files;
            if (streams.length === 0) {
              console.log(chalk.yellow("No recording files available."));
              return;
            }
          }

          await mkdir(outDir, { recursive: true });

          let done = 0;
          const total = streams.length;
          const CONCURRENCY = 8;

          const downloadOne = async (stream: string): Promise<void> => {
            try {
              const data = await client.getRecordingStream(sessionId, stream);
              const outPath = join(outDir, stream);
              await mkdir(dirname(outPath), { recursive: true });
              await writeFile(outPath, Buffer.from(data));
              done++;
              process.stdout.write(
                `\r  ${done}/${total}  ${chalk.green("✓")} ${stream} ${chalk.dim(`(${formatBytes(data.byteLength)})`)}`.padEnd(80)
              );
            } catch (streamErr) {
              done++;
              const msg =
                streamErr instanceof Error ? streamErr.message : String(streamErr);
              process.stdout.write(
                `\r  ${done}/${total}  ${chalk.red("✗")} ${stream}: ${msg}`.padEnd(80) + "\n"
              );
            }
          };

          // Run with bounded concurrency
          const queue = [...streams];
          const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
            while (queue.length > 0) {
              const stream = queue.shift()!;
              await downloadOne(stream);
            }
          });
          await Promise.all(workers);
          process.stdout.write("\n");

          console.log(chalk.green(`✓ Done. Files written to ${outDir}`));
        } catch (err) {
          handleError(err);
        }
      }
    );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
