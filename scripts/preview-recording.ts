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

async function detectDimensions(
  inputDir: string,
  metadataDir: string,
  cameraName: string
): Promise<{ width: number; height: number }> {
  // 1. Try metadata.json cameras map (written by recorder for new sessions)
  const metaPath = join(metadataDir, "metadata.json");
  if (existsSync(metaPath)) {
    try {
      const meta = JSON.parse(await readFile(metaPath, "utf-8"));
      const spec = meta?.cameras?.[cameraName];
      if (spec?.width && spec?.height) {
        return { width: spec.width, height: spec.height };
      }
    } catch { /* fall through */ }
  }

  // 2. Auto-detect from the first frame's byte length against common resolutions
  const firstFile = (await readdir(inputDir)).filter((f) => f.endsWith(".raw")).sort()[0];
  if (firstFile) {
    const bytes = (await readFile(join(inputDir, firstFile))).length;
    const pixels = bytes / 3;
    const COMMON = [
      { width: 64,   height: 64   },
      { width: 128,  height: 128  },
      { width: 160,  height: 120  },
      { width: 256,  height: 256  },
      { width: 320,  height: 240  },
      { width: 640,  height: 480  },
      { width: 1280, height: 720  },
      { width: 1920, height: 1080 },
    ];
    const match = COMMON.find((r) => r.width * r.height === pixels);
    if (match) return match;
  }

  // 3. Fall back to 64×64 with a warning
  console.warn("Could not detect camera dimensions — defaulting to 64x64. Pass --width and --height if this is wrong.");
  return { width: 64, height: 64 };
}

async function convertDir(inputDir: string, outDir: string, metadataDir: string, cameraName: string) {
  await mkdir(outDir, { recursive: true });

  const files = (await readdir(inputDir)).filter((f) => f.endsWith(".raw")).sort();
  console.log(`Found ${files.length} raw camera frames in ${inputDir}`);

  const { width, height } = await detectDimensions(inputDir, metadataDir, cameraName);
  console.log(`Camera dimensions: ${width}x${height}`);
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
  const sdkCamerasDir = join("packages", "sdk", "recordings", sessionId, "cameras");

  if (existsSync(camerasDir)) {
    const metaDir = join("recordings", sessionId);
    await convertDir(camerasDir, outputDir, metaDir, "cam0");
  } else if (existsSync(sdkCamerasDir)) {
    const metaDir = join("packages", "sdk", "recordings", sessionId);
    await convertDir(sdkCamerasDir, outputDir, metaDir, "cam0");
  } else {
    console.error(`No cameras directory found at ${camerasDir} or ${sdkCamerasDir}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
