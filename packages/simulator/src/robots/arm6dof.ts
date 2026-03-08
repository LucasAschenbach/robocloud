import { create } from "@bufbuild/protobuf";
import {
  type Command,
  type TelemetryFrame,
  type RobotCapabilities,
  TelemetryFrameSchema,
  RobotCapabilitiesSchema,
  JointSpecSchema,
  CameraSpecSchema,
  JointStateSchema,
  CameraFrameSchema,
  Mobility,
} from "@robocloud/shared";
import type { SimulatedRobot } from "../types.js";

const JOINT_NAMES = [
  "shoulder_pan",
  "shoulder_lift",
  "elbow",
  "wrist_1",
  "wrist_2",
  "wrist_3",
] as const;

interface JointSim {
  position: number;
  velocity: number;
  targetPosition: number;
  min: number;
  max: number;
  maxVelocity: number;
}

export class Arm6DOF implements SimulatedRobot {
  readonly id: string;
  readonly name: string;
  readonly model = "sim-arm-6dof";

  private joints: Map<string, JointSim> = new Map();
  private gripperOpenness = 1.0;
  private stepCount = 0;

  constructor(id: string, name: string) {
    this.id = id;
    this.name = name;
    this.reset();
  }

  getCapabilities(): RobotCapabilities {
    return create(RobotCapabilitiesSchema, {
      joints: JOINT_NAMES.map((jname) => {
        const j = this.joints.get(jname)!;
        return create(JointSpecSchema, {
          name: jname,
          minPosition: j.min,
          maxPosition: j.max,
          maxVelocity: j.maxVelocity,
          maxTorque: 10.0,
        });
      }),
      endEffector: true,
      cameras: [
        create(CameraSpecSchema, { name: "cam0", width: 64, height: 64, fps: 30 }),
      ],
      mobility: Mobility.FIXED,
    });
  }

  applyCommand(cmd: Command): void {
    switch (cmd.command.case) {
      case "jointPosition": {
        const positions = cmd.command.value.positions;
        for (const [name, target] of Object.entries(positions)) {
          const joint = this.joints.get(name);
          if (joint) {
            joint.targetPosition = Math.max(joint.min, Math.min(joint.max, target));
          }
        }
        break;
      }
      case "jointVelocity": {
        const velocities = cmd.command.value.velocities;
        for (const [name, vel] of Object.entries(velocities)) {
          const joint = this.joints.get(name);
          if (joint) {
            const clampedVel = Math.max(-joint.maxVelocity, Math.min(joint.maxVelocity, vel));
            joint.targetPosition = joint.position + clampedVel * 0.1;
            joint.targetPosition = Math.max(joint.min, Math.min(joint.max, joint.targetPosition));
          }
        }
        break;
      }
      case "gripper": {
        this.gripperOpenness = Math.max(0, Math.min(1, cmd.command.value.openness));
        break;
      }
      default:
        break;
    }
  }

  step(dtSeconds: number): void {
    this.stepCount++;
    const stiffness = 10.0;
    const damping = 5.0;

    for (const joint of this.joints.values()) {
      const error = joint.targetPosition - joint.position;
      const force = stiffness * error - damping * joint.velocity;
      const acceleration = force;
      joint.velocity += acceleration * dtSeconds;
      joint.velocity = Math.max(-joint.maxVelocity, Math.min(joint.maxVelocity, joint.velocity));
      joint.position += joint.velocity * dtSeconds;
      joint.position = Math.max(joint.min, Math.min(joint.max, joint.position));
    }
  }

  getTelemetry(): TelemetryFrame {
    const jointStates: { [key: string]: ReturnType<typeof create<typeof JointStateSchema>> } = {};
    for (const [name, joint] of this.joints) {
      jointStates[name] = create(JointStateSchema, {
        position: joint.position,
        velocity: joint.velocity,
        torque: 0,
      });
    }

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
      jointStates,
      cameras,
    });
  }

  reset(): void {
    this.joints.clear();
    this.stepCount = 0;
    this.gripperOpenness = 1.0;

    const specs: Array<{ name: string; min: number; max: number; maxVel: number }> = [
      { name: "shoulder_pan", min: -Math.PI, max: Math.PI, maxVel: 2.0 },
      { name: "shoulder_lift", min: -Math.PI, max: 0, maxVel: 2.0 },
      { name: "elbow", min: -Math.PI, max: Math.PI, maxVel: 3.0 },
      { name: "wrist_1", min: -Math.PI, max: Math.PI, maxVel: 3.0 },
      { name: "wrist_2", min: -Math.PI, max: Math.PI, maxVel: 3.0 },
      { name: "wrist_3", min: -2 * Math.PI, max: 2 * Math.PI, maxVel: 3.0 },
    ];

    for (const spec of specs) {
      this.joints.set(spec.name, {
        position: 0,
        velocity: 0,
        targetPosition: 0,
        min: spec.min,
        max: spec.max,
        maxVelocity: spec.maxVel,
      });
    }
  }

  private generateSyntheticFrame(): Uint8Array {
    const w = 64;
    const h = 64;
    const pixels = new Uint8Array(w * h * 3);

    const shoulder = this.joints.get("shoulder_pan")!;
    const elbow = this.joints.get("elbow")!;

    const r = Math.floor(128 + 127 * Math.sin(shoulder.position));
    const g = Math.floor(128 + 127 * Math.sin(elbow.position));
    const b = Math.floor(this.gripperOpenness * 255);

    for (let i = 0; i < w * h; i++) {
      pixels[i * 3] = r;
      pixels[i * 3 + 1] = g;
      pixels[i * 3 + 2] = b;
    }

    return pixels;
  }
}
