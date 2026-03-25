import type {
  VoiceRealtimeClientSecret,
  VoiceRealtimeSessionCreateInput,
} from "@t3tools/contracts";
import { Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

export class RealtimeTokenServiceError extends Schema.TaggedErrorClass<RealtimeTokenServiceError>()(
  "RealtimeTokenServiceError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export interface RealtimeTokenServiceShape {
  readonly createClientSecret: (
    input: VoiceRealtimeSessionCreateInput,
  ) => Effect.Effect<VoiceRealtimeClientSecret, RealtimeTokenServiceError>;
}

export class RealtimeTokenService extends ServiceMap.Service<
  RealtimeTokenService,
  RealtimeTokenServiceShape
>()("t3/voice/Services/RealtimeTokenService") {}
