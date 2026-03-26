import { Schema } from "effect";

import { IsoDateTime, ThreadId, TrimmedNonEmptyString } from "./baseSchemas";

export const VoiceSessionPhase = Schema.Literals([
  "idle",
  "connecting",
  "ready",
  "listening",
  "processing",
  "error",
]);
export type VoiceSessionPhase = typeof VoiceSessionPhase.Type;

export const VoiceRealtimeSessionCreateInput = Schema.Struct({
  threadId: ThreadId,
  model: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  voice: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
});
export type VoiceRealtimeSessionCreateInput = typeof VoiceRealtimeSessionCreateInput.Type;

export const VoiceSpeechSynthesisInput = Schema.Struct({
  threadId: ThreadId,
  text: TrimmedNonEmptyString,
  model: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  voice: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  instructions: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
});
export type VoiceSpeechSynthesisInput = typeof VoiceSpeechSynthesisInput.Type;

export const VoiceSpeechSynthesisResult = Schema.Struct({
  audioBase64: TrimmedNonEmptyString,
  mimeType: TrimmedNonEmptyString,
});
export type VoiceSpeechSynthesisResult = typeof VoiceSpeechSynthesisResult.Type;

export const VoiceRealtimeClientSecret = Schema.Struct({
  value: TrimmedNonEmptyString,
  expiresAt: IsoDateTime,
  sessionId: Schema.optional(TrimmedNonEmptyString),
});
export type VoiceRealtimeClientSecret = typeof VoiceRealtimeClientSecret.Type;

export const VoiceTranscriptSegment = Schema.Struct({
  id: TrimmedNonEmptyString,
  text: Schema.String,
  isFinal: Schema.Boolean,
  createdAt: IsoDateTime,
});
export type VoiceTranscriptSegment = typeof VoiceTranscriptSegment.Type;
