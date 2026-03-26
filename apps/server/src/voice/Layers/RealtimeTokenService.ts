import type { VoiceRealtimeClientSecret } from "@t3tools/contracts";
import { Config, Effect, Layer } from "effect";

import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import {
  RealtimeTokenService,
  RealtimeTokenServiceError,
  type RealtimeTokenServiceShape,
} from "../Services/RealtimeTokenService.ts";

const RealtimeEnvConfig = Config.all({
  apiKey: Config.string("OPENAI_API_KEY"),
  model: Config.string("T3CODE_VOICE_MODEL").pipe(Config.withDefault("gpt-realtime")),
  voice: Config.string("T3CODE_VOICE_NAME").pipe(Config.withDefault("alloy")),
});

const REALTIME_SUPPORTED_VOICES = new Set([
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "sage",
  "shimmer",
  "verse",
  "cedar",
  "marin",
]);

interface OpenAIRealtimeClientSecretResponse {
  readonly value?: unknown;
  readonly expires_at?: unknown;
  readonly session?: {
    readonly id?: unknown;
  };
}

function buildSessionInstructions(input: {
  readonly threadTitle: string;
  readonly projectTitle: string;
}): string {
  return [
    "You are handling live voice input for a coding chat application.",
    "Prioritize accurate transcription of the user's speech.",
    "Keep any spoken response extremely brief.",
    "Do not invent actions, tool use, or code changes.",
    `Current thread: ${input.threadTitle}.`,
    `Current project: ${input.projectTitle}.`,
  ].join(" ");
}

function toRealtimeTokenError(message: string, cause?: unknown): RealtimeTokenServiceError {
  return new RealtimeTokenServiceError({
    message,
    ...(cause !== undefined ? { cause } : {}),
  });
}

const makeRealtimeTokenService = Effect.gen(function* () {
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;

  const createClientSecret: RealtimeTokenServiceShape["createClientSecret"] = (input) =>
    Effect.gen(function* () {
      const config = yield* RealtimeEnvConfig.asEffect().pipe(
        Effect.mapError((cause) =>
          toRealtimeTokenError("Failed to read OpenAI Realtime configuration.", cause),
        ),
      );
      const snapshot = yield* projectionSnapshotQuery
        .getSnapshot()
        .pipe(
          Effect.mapError((cause) =>
            toRealtimeTokenError(
              "Failed to load thread snapshot for voice session creation.",
              cause,
            ),
          ),
        );
      const thread = snapshot.threads.find((candidate) => candidate.id === input.threadId);
      if (!thread || thread.deletedAt !== null) {
        return yield* toRealtimeTokenError(
          `Unknown thread '${input.threadId}' for voice session creation.`,
        );
      }
      const project = snapshot.projects.find((candidate) => candidate.id === thread.projectId);
      if (!project || project.deletedAt !== null) {
        return yield* toRealtimeTokenError(
          `Unknown project '${thread.projectId}' for thread '${input.threadId}'.`,
        );
      }

      const sessionPayload = {
        session: {
          type: "realtime",
          model: input.model ?? config.model,
          output_modalities: ["audio"],
          instructions: buildSessionInstructions({
            threadTitle: thread.title,
            projectTitle: project.title,
          }),
          audio: {
            input: {
              transcription: {
                model: "gpt-4o-mini-transcribe",
              },
              turn_detection: {
                type: "server_vad",
                create_response: false,
                interrupt_response: false,
                prefix_padding_ms: 300,
                silence_duration_ms: 700,
                threshold: 0.5,
              },
            },
            ...(REALTIME_SUPPORTED_VOICES.has(input.voice ?? config.voice)
              ? {
                  output: {
                    voice: input.voice ?? config.voice,
                  },
                }
              : {}),
          },
        },
      };

      const response = yield* Effect.tryPromise({
        try: () =>
          fetch("https://api.openai.com/v1/realtime/client_secrets", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${config.apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(sessionPayload),
          }),
        catch: (cause) =>
          toRealtimeTokenError("Failed to call OpenAI Realtime client secrets endpoint.", cause),
      });

      const payload = (yield* Effect.tryPromise({
        try: () => response.json() as Promise<OpenAIRealtimeClientSecretResponse>,
        catch: (cause) =>
          toRealtimeTokenError("Failed to parse OpenAI Realtime client secret response.", cause),
      })) satisfies OpenAIRealtimeClientSecretResponse;

      if (!response.ok) {
        const message =
          payload &&
          typeof payload === "object" &&
          "error" in payload &&
          payload.error &&
          typeof payload.error === "object" &&
          "message" in payload.error &&
          typeof payload.error.message === "string"
            ? payload.error.message
            : `OpenAI Realtime client secret request failed with status ${response.status}.`;
        return yield* toRealtimeTokenError(message);
      }

      if (typeof payload.value !== "string" || payload.value.trim().length === 0) {
        return yield* toRealtimeTokenError(
          "OpenAI Realtime client secret response did not include a token.",
        );
      }

      if (typeof payload.expires_at !== "number" || !Number.isFinite(payload.expires_at)) {
        return yield* toRealtimeTokenError(
          "OpenAI Realtime client secret response did not include a valid expiry.",
        );
      }

      const expiresAt = new Date(payload.expires_at * 1000).toISOString();

      return {
        value: payload.value,
        expiresAt,
        ...(typeof payload.session?.id === "string" ? { sessionId: payload.session.id } : {}),
      } satisfies VoiceRealtimeClientSecret;
    });

  return {
    createClientSecret,
  } satisfies RealtimeTokenServiceShape;
});

export const RealtimeTokenServiceLive = Layer.effect(
  RealtimeTokenService,
  makeRealtimeTokenService,
);
