#!/usr/bin/env npx tsx
/**
 * Preview a recorded session's camera frames as PPM images (viewable in any image viewer).
 *
 * Usage:
 *   npx tsx scripts/preview-recording.ts <session-id> [output-dir]
 *
 * The simulator stores raw RGB frames (64x64x3 bytes). This script converts them to PPM
 * format which can be opened by Preview (macOS), GIMP, ImageMagick, ffmpeg, etc.
 *
 * To create a video from the frames:
 *   ffmpeg -framerate 30 -i output/%06d.ppm -c:v libx264 -pix_fmt yuv420p output.mp4
 */

import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { existsSync } from "node:fs";

async function convertDir(inputDir: string, outDir: string) {
  await mkdir(outDir, { recursive: true });

  const files = (await readdir(inputDir)).filter((f) => f.endsWith(".raw")).sort();
  console.log(`Found ${files.length} raw camera frames in ${inputDir}`);

  const width = 64;
  const height = 64;
  let converted = 0;

  for (const file of files) {
    const raw = await readFile(join(inputDir, file));
    const expectedSize = width * height * 3;

    if (raw.length !== expectedSize) {
      console.warn(`Skipping ${file}: expected ${expectedSize} bytes, got ${raw.length}`);
      continue;
    }

    const ppmHeader = `P6\n${width} ${height}\n255\n`;
    const headerBuf = Buffer.from(ppmHeader, "ascii");
    const ppm = Buffer.concat([headerBuf, raw]);

    const outName = basename(file, ".raw") + ".ppm";
    await writeFile(join(outDir, outName), ppm);
    converted++;
  }

  console.log(`Converted ${converted} frames to PPM in ${outDir}`);
  console.log(`\nTo view:  open ${outDir}/cam0_000001.ppm`);
  console.log(`To video: ffmpeg -framerate 30 -pattern_type glob -i '${outDir}/cam0_*.ppm' -c:v libx264 -pix_fmt yuv420p recording.mp4`);

  if (existsSync(join(inputDir, "..", "metadata.json"))) {
    const meta = JSON.parse(await readFile(join(inputDir, "..", "metadata.json"), "utf-8"));
    console.log(`\nSession metadata:`);
    console.log(`  Robot: ${meta.robotModel} (${meta.robotId})`);
    console.log(`  Start: ${meta.startTime}`);
    console.log(`  End:   ${meta.endTime}`);
    console.log(`  Camera frames: ${meta.totalCameraFrames}`);
  }

  if (existsSync(join(inputDir, "..", "telemetry.jsonl"))) {
    const telemetryLines = (await readFile(join(inputDir, "..", "telemetry.jsonl"), "utf-8")).trim().split("\n");
    console.log(`  Telemetry entries: ${telemetryLines.length}`);
  }

  if (existsSync(join(inputDir, "..", "commands.jsonl"))) {
    const cmdLines = (await readFile(join(inputDir, "..", "commands.jsonl"), "utf-8")).trim().split("\n");
    console.log(`  Command entries: ${cmdLines.length}`);
  }
}

async function main() {
  const sessionId = process.argv[2];

  if (!sessionId) {
    console.error("Usage: npx tsx scripts/preview-recording.ts <session-id> [output-dir]");
    process.exit(1);
  }

  const outputDir = process.argv[3] ?? join("recordings", sessionId, "preview");

  const camerasDir = join("recordings", sessionId, "cameras");
  if (!existsSync(camerasDir)) {
    const sdkCamerasDir = join("packages", "sdk", "recordings", sessionId, "cameras");
    if (existsSync(sdkCamerasDir)) {
      await convertDir(sdkCamerasDir, outputDir);
    } else {
      console.error(`No cameras directory found at ${camerasDir} or ${sdkCamerasDir}`);
      process.exit(1);
    }
  } else {
    await convertDir(camerasDir, outputDir);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
