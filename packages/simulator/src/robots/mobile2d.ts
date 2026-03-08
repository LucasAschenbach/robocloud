import { create } from "@bufbuild/protobuf";
import {
  type Command,
  type TelemetryFrame,
  type RobotCapabilities,
  TelemetryFrameSchema,
  RobotCapabilitiesSchema,
  CameraSpecSchema,
  CameraFrameSchema,
  Pose6DSchema,
  Vec3Schema,
  QuaternionSchema,
  Mobility,
} from "@robocloud/shared";
import type { SimulatedRobot } from "../types.js";

export class Mobile2D implements SimulatedRobot {
  readonly id: string;
  readonly name: string;
  readonly model = "sim-mobile-2d";

  private x = 0;
  private y = 0;
  private heading = 0;
  private linearVel = 0;
  private angularVel = 0;
  private stepCount = 0;

  constructor(id: string, name: string) {
    this.id = id;
    this.name = name;
  }

  getCapabilities(): RobotCapabilities {
    return create(RobotCapabilitiesSchema, {
      joints: [],
      endEffector: false,
      cameras: [
        create(CameraSpecSchema, { name: "cam0", width: 64, height: 64, fps: 30 }),
      ],
      mobility: Mobility.WHEELED,
    });
  }

  applyCommand(cmd: Command): void {
    if (cmd.command.case === "velocity") {
      const { linear, angular } = cmd.command.value;
      this.linearVel = linear?.x ?? 0;
      this.angularVel = angular?.z ?? 0;
    }
  }

  step(dtSeconds: number): void {
    this.stepCount++;
    this.heading += this.angularVel * dtSeconds;
    this.x += this.linearVel * Math.cos(this.heading) * dtSeconds;
    this.y += this.linearVel * Math.sin(this.heading) * dtSeconds;

    const friction = 0.98;
    this.linearVel *= friction;
    this.angularVel *= friction;
  }

  getTelemetry(): TelemetryFrame {
    const halfHeading = this.heading / 2;
    const cameras = [];

    if (this.stepCount % 3 === 0) {
      cameras.push(
        create(CameraFrameSchema, {
          cameraName: "cam0",
          data: this.generateSyntheticFrame(),
          format: "raw-rgb",
          width: 64,
          height: 64,
        })
      );
    }

    return create(TelemetryFrameSchema, {
      timestampUs: BigInt(Math.floor(performance.now() * 1000)),
      jointStates: {},
      basePose: create(Pose6DSchema, {
        position: create(Vec3Schema, { x: this.x, y: this.y, z: 0 }),
        orientation: create(QuaternionSchema, {
          x: 0,
          y: 0,
          z: Math.sin(halfHeading),
          w: Math.cos(halfHeading),
        }),
      }),
      cameras,
    });
  }

  reset(): void {
    this.x = 0;
    this.y = 0;
    this.heading = 0;
    this.linearVel = 0;
    this.angularVel = 0;
    this.stepCount = 0;
  }

  private generateSyntheticFrame(): Uint8Array {
    const w = 64;
    const h = 64;
    const pixels = new Uint8Array(w * h * 3);

    const normX = ((this.x % 10) + 10) % 10 / 10;
    const normY = ((this.y % 10) + 10) % 10 / 10;

    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        const i = (row * w + col) * 3;
        pixels[i] = Math.floor(normX * 255);
        pixels[i + 1] = Math.floor(normY * 255);
        pixels[i + 2] = Math.floor(128 + 127 * Math.sin(this.heading));
      }
    }

    return pixels;
  }
}
