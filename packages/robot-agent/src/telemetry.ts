import { create, toBinary } from "@bufbuild/protobuf";
import {
  type Envelope,
  type TelemetryFrame,
  EnvelopeSchema,
} from "@robocloud/shared";

let sequenceCounter = 0n;

export function wrapTelemetry(
  sessionId: string,
  telemetry: TelemetryFrame
): Uint8Array {
  const envelope: Envelope = create(EnvelopeSchema, {
    sequence: sequenceCounter++,
    timestampUs: BigInt(Math.floor(performance.now() * 1000)),
    sessionId,
    payload: {
      case: "telemetry",
      value: telemetry,
    },
  });

  return toBinary(EnvelopeSchema, envelope);
}

export function resetSequence(): void {
  sequenceCounter = 0n;
}
