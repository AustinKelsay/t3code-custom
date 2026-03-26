import type { VoiceSpeechSynthesisResult } from "@t3tools/contracts";
import { Config, Effect, Layer } from "effect";

import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import {
  SpeechSynthesisService,
  SpeechSynthesisServiceError,
  type SpeechSynthesisServiceShape,
} from "../Services/SpeechSynthesisService.ts";

const SpeechSynthesisEnvConfig = Config.all({
  apiKey: Config.string("OPENAI_API_KEY"),
  model: Config.string("T3CODE_TTS_MODEL").pipe(Config.withDefault("gpt-4o-mini-tts")),
  voice: Config.string("T3CODE_VOICE_NAME").pipe(Config.withDefault("alloy")),
});

function toSpeechSynthesisServiceError(
  message: string,
  cause?: unknown,
): SpeechSynthesisServiceError {
  return new SpeechSynthesisServiceError({
    message,
    ...(cause !== undefined ? { cause } : {}),
  });
}

const makeSpeechSynthesisService = Effect.gen(function* () {
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;

  const synthesize: SpeechSynthesisServiceShape["synthesize"] = (input) =>
    Effect.gen(function* () {
      const config = yield* SpeechSynthesisEnvConfig.asEffect().pipe(
        Effect.mapError((cause) =>
          toSpeechSynthesisServiceError("Failed to read OpenAI TTS configuration.", cause),
        ),
      );
      const snapshot = yield* projectionSnapshotQuery
        .getSnapshot()
        .pipe(
          Effect.mapError((cause) =>
            toSpeechSynthesisServiceError(
              "Failed to load thread snapshot for voice synthesis.",
              cause,
            ),
          ),
        );
      const thread = snapshot.threads.find((candidate) => candidate.id === input.threadId);
      if (!thread || thread.deletedAt !== null) {
        return yield* toSpeechSynthesisServiceError(
          `Unknown thread '${input.threadId}' for voice synthesis.`,
        );
      }

      const response = yield* Effect.tryPromise({
        try: () =>
          fetch("https://api.openai.com/v1/audio/speech", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${config.apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: input.model ?? config.model,
              voice: input.voice ?? config.voice,
              input: input.text,
              ...(input.instructions ? { instructions: input.instructions } : {}),
              format: "mp3",
            }),
          }),
        catch: (cause) =>
          toSpeechSynthesisServiceError("Failed to call OpenAI speech synthesis endpoint.", cause),
      });

      if (!response.ok) {
        const payload = yield* Effect.tryPromise({
          try: async () => {
            try {
              return await response.text();
            } catch {
              return "";
            }
          },
          catch: (cause) =>
            toSpeechSynthesisServiceError(
              "Failed to read OpenAI speech synthesis error response.",
              cause,
            ),
        });
        return yield* toSpeechSynthesisServiceError(
          payload.trim().length > 0
            ? payload
            : `OpenAI speech synthesis request failed with status ${response.status}.`,
        );
      }

      const arrayBuffer = yield* Effect.tryPromise({
        try: () => response.arrayBuffer(),
        catch: (cause) =>
          toSpeechSynthesisServiceError(
            "Failed to read OpenAI speech synthesis audio response.",
            cause,
          ),
      });

      const audioBase64 = Buffer.from(arrayBuffer).toString("base64");
      if (audioBase64.length === 0) {
        return yield* toSpeechSynthesisServiceError(
          "OpenAI speech synthesis response did not include audio data.",
        );
      }

      return {
        audioBase64,
        mimeType: "audio/mpeg",
      } satisfies VoiceSpeechSynthesisResult;
    });

  return {
    synthesize,
  } satisfies SpeechSynthesisServiceShape;
});

export const SpeechSynthesisServiceLive = Layer.effect(
  SpeechSynthesisService,
  makeSpeechSynthesisService,
);
