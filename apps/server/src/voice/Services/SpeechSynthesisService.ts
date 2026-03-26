import type { VoiceSpeechSynthesisInput, VoiceSpeechSynthesisResult } from "@t3tools/contracts";
import { Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

export class SpeechSynthesisServiceError extends Schema.TaggedErrorClass<SpeechSynthesisServiceError>()(
  "SpeechSynthesisServiceError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export interface SpeechSynthesisServiceShape {
  readonly synthesize: (
    input: VoiceSpeechSynthesisInput,
  ) => Effect.Effect<VoiceSpeechSynthesisResult, SpeechSynthesisServiceError>;
}

export class SpeechSynthesisService extends ServiceMap.Service<
  SpeechSynthesisService,
  SpeechSynthesisServiceShape
>()("t3/voice/Services/SpeechSynthesisService") {}
