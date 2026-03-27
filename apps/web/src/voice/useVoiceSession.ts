import type { ThreadId } from "@t3tools/contracts";
import { OpenAIRealtimeWebRTC, RealtimeAgent, RealtimeSession } from "@openai/agents/realtime";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import { DEFAULT_VOICE_SILENCE_DURATION_MS } from "../appSettings";
import { ensureNativeApi } from "../nativeApi";
import { normalizeRealtimeVoiceName } from "./realtimeVoice";
import { useVoiceActivityMonitor } from "./useVoiceActivityMonitor";
import { useVoiceCuePlayer } from "./useVoiceCuePlayer";
import { registerVoiceSession, releaseVoiceSession } from "./voiceSessionRegistry";
import { voiceReducer } from "./voiceReducer";
import { DEFAULT_VOICE_UI_STATE } from "./types";

const STOP_LISTENING_FINALIZATION_GRACE_MS = 1500;
const PUSH_TO_TALK_RELEASE_TAIL_MS = 300;
const PUSH_TO_TALK_TRANSCRIPT_WAIT_MS = 1500;
interface UseVoiceSessionInput {
  readonly threadId: ThreadId;
  readonly enabled: boolean;
  readonly wakePhraseEnabled?: boolean;
  readonly liveRepliesEnabled: boolean;
  readonly model: string | null;
  readonly voice: string | null;
  readonly microphoneDeviceId?: string | null;
  readonly silenceDurationMs?: number;
  readonly onFinalTranscript: (text: string) => void | Promise<void>;
}

export function useVoiceSession(input: UseVoiceSessionInput) {
  const {
    threadId,
    enabled,
    liveRepliesEnabled,
    model,
    voice,
    microphoneDeviceId,
    silenceDurationMs = 3000,
    onFinalTranscript,
  } = input;
  const resolvedSilenceDurationMs =
    Number.isFinite(silenceDurationMs) && silenceDurationMs > 0
      ? Math.round(silenceDurationMs)
      : DEFAULT_VOICE_SILENCE_DURATION_MS;
  const [state, dispatch] = useReducer(voiceReducer, DEFAULT_VOICE_UI_STATE);
  const [activeMicrophoneLabel, setActiveMicrophoneLabel] = useState<string | null>(null);
  const realtimeVoice = normalizeRealtimeVoiceName(voice);
  const sessionRef = useRef<RealtimeSession | null>(null);
  const selectedMicrophoneDeviceId = microphoneDeviceId?.trim() || null;
  const finalizedItemIdsRef = useRef(new Set<string>());
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const liveReplyResponseIdsRef = useRef(new Set<string>());
  const pendingResponseCreateRef = useRef(false);
  const pendingLiveReplyRef = useRef(false);
  const queuedAssistantSpeechRef = useRef<string[]>([]);
  const keepHotMicRef = useRef(false);
  const activeCaptureModeRef = useRef<"idle" | "manual" | "wake">("idle");
  const pendingManualCommitRef = useRef(false);
  const sessionAttemptIdRef = useRef(0);
  const captureCycleIdRef = useRef(0);
  const autoStopAfterNextTranscriptRef = useRef(false);
  const pendingStopTimeoutRef = useRef<number | null>(null);
  const pendingTranscriptWaitTimeoutRef = useRef<number | null>(null);
  const silenceFallbackTimeoutRef = useRef<number | null>(null);
  const silenceFallbackFinalizeTimeoutRef = useRef<number | null>(null);
  const phaseRef = useRef(DEFAULT_VOICE_UI_STATE.phase);
  const transcriptPreviewRef = useRef("");
  const utteranceHandledRef = useRef(false);
  const autoStopProcessingStartedRef = useRef(false);
  const { playListeningStartCue, playListeningStopCue } = useVoiceCuePlayer();
  const { startMonitoring: startVoiceActivityMonitoring, stopMonitoring: stopVoiceActivityMonitoring } =
    useVoiceActivityMonitor();
  const onFinalTranscriptRef = useRef(onFinalTranscript);
  useEffect(() => {
    onFinalTranscriptRef.current = onFinalTranscript;
  }, [onFinalTranscript]);

  useEffect(() => {
    phaseRef.current = state.phase;
  }, [state.phase]);

  useEffect(() => {
    const trimmedVoice = voice?.trim().toLowerCase() ?? "";
    if (trimmedVoice && realtimeVoice === null) {
      console.warn(
        "[voice] Unsupported realtime voice configured, falling back to server default.",
        {
          configuredVoice: trimmedVoice,
        },
      );
    }
  }, [realtimeVoice, voice]);

  const clearPendingStopTimeout = useCallback(() => {
    if (pendingStopTimeoutRef.current !== null && typeof window !== "undefined") {
      window.clearTimeout(pendingStopTimeoutRef.current);
      pendingStopTimeoutRef.current = null;
    }
  }, []);

  const clearPendingTranscriptWaitTimeout = useCallback(() => {
    if (pendingTranscriptWaitTimeoutRef.current !== null && typeof window !== "undefined") {
      window.clearTimeout(pendingTranscriptWaitTimeoutRef.current);
      pendingTranscriptWaitTimeoutRef.current = null;
    }
  }, []);

  const clearSilenceFallbackTimeouts = useCallback(() => {
    if (typeof window !== "undefined") {
      if (silenceFallbackTimeoutRef.current !== null) {
        window.clearTimeout(silenceFallbackTimeoutRef.current);
        silenceFallbackTimeoutRef.current = null;
      }
      if (silenceFallbackFinalizeTimeoutRef.current !== null) {
        window.clearTimeout(silenceFallbackFinalizeTimeoutRef.current);
        silenceFallbackFinalizeTimeoutRef.current = null;
      }
    }
  }, []);

  const logVoiceError = useCallback(
    (label: string, error: unknown) => {
      console.error(`[voice] ${label}`, {
        threadId,
        sessionAttemptId: sessionAttemptIdRef.current,
        captureCycleId: captureCycleIdRef.current,
        activeCaptureMode: activeCaptureModeRef.current,
        phase: phaseRef.current,
        error,
      });
    },
    [threadId],
  );

  const logVoiceTrace = useCallback(
    (label: string, details?: Record<string, unknown>) => {
      console.log(`[voice] ${label}`, {
        threadId,
        sessionAttemptId: sessionAttemptIdRef.current,
        captureCycleId: captureCycleIdRef.current,
        activeCaptureMode: activeCaptureModeRef.current,
        phase: phaseRef.current,
        ...details,
      });
    },
    [threadId],
  );

  const isEmptyCommitError = useCallback((error: unknown) => {
    const stack: unknown[] = [error];
    while (stack.length > 0) {
      const current = stack.pop();
      if (typeof current !== "object" || current === null) {
        continue;
      }
      if (
        "code" in current &&
        (current as { code?: unknown }).code === "input_audio_buffer_commit_empty"
      ) {
        return true;
      }
      if ("error" in current) {
        stack.push((current as { error?: unknown }).error);
      }
    }
    return false;
  }, []);

  const setSessionMuted = useCallback(
    (muted: boolean) => {
      logVoiceTrace("setSessionMuted", { muted });
      const session = sessionRef.current;
      session?.mute(muted);
    },
    [logVoiceTrace],
  );

  const releaseMediaStream = useCallback(() => {
    const stream = mediaStreamRef.current;
    if (!stream) {
      setActiveMicrophoneLabel(null);
      return;
    }
    mediaStreamRef.current = null;
    setActiveMicrophoneLabel(null);
    for (const track of stream.getTracks()) {
      track.stop();
    }
  }, []);

  const ensureAudioElement = useCallback(() => {
    if (typeof document === "undefined") {
      return null;
    }
    const existing = audioElementRef.current;
    if (existing) {
      return existing;
    }

    const audioElement = document.createElement("audio");
    audioElement.autoplay = true;
    audioElement.muted = false;
    audioElement.className = "hidden";
    audioElement.dataset.t3VoicePlayback = "true";
    audioElement.setAttribute("playsinline", "");
    document.body.append(audioElement);
    audioElementRef.current = audioElement;
    return audioElement;
  }, []);

  const releaseAudioElement = useCallback(() => {
    const audioElement = audioElementRef.current;
    if (!audioElement) {
      return;
    }
    audioElement.pause();
    audioElement.srcObject = null;
    audioElement.remove();
    audioElementRef.current = null;
  }, []);

  const closeSession = useCallback(() => {
    clearPendingStopTimeout();
    clearPendingTranscriptWaitTimeout();
    clearSilenceFallbackTimeouts();
    keepHotMicRef.current = false;
    stopVoiceActivityMonitoring();
    const session = sessionRef.current;
    if (!session) {
      releaseMediaStream();
      releaseAudioElement();
      releaseVoiceSession(threadId);
      dispatch({ type: "reset" });
      return;
    }
    session.close();
    releaseMediaStream();
    sessionRef.current = null;
    finalizedItemIdsRef.current.clear();
    liveReplyResponseIdsRef.current.clear();
    pendingResponseCreateRef.current = false;
    pendingLiveReplyRef.current = false;
    queuedAssistantSpeechRef.current = [];
    autoStopAfterNextTranscriptRef.current = false;
    autoStopProcessingStartedRef.current = false;
    activeCaptureModeRef.current = "idle";
    pendingManualCommitRef.current = false;
    releaseAudioElement();
    releaseVoiceSession(threadId);
    dispatch({ type: "reset" });
    transcriptPreviewRef.current = "";
    utteranceHandledRef.current = false;
  }, [
    clearPendingStopTimeout,
    clearPendingTranscriptWaitTimeout,
    clearSilenceFallbackTimeouts,
    releaseAudioElement,
    releaseMediaStream,
    stopVoiceActivityMonitoring,
    threadId,
  ]);

  useEffect(() => {
    if (!sessionRef.current) {
      return;
    }
    logVoiceTrace("microphoneDeviceId.changed", {
      microphoneDeviceId: selectedMicrophoneDeviceId,
    });
    closeSession();
  }, [closeSession, logVoiceTrace, selectedMicrophoneDeviceId]);

  const beginAutoStopProcessing = useCallback(() => {
    if (autoStopProcessingStartedRef.current) {
      return;
    }
    logVoiceTrace("beginAutoStopProcessing");
    autoStopProcessingStartedRef.current = true;
    keepHotMicRef.current = false;
    activeCaptureModeRef.current = "idle";
    setSessionMuted(true);
    dispatch({ type: "processing_started" });
    playListeningStopCue();
  }, [logVoiceTrace, playListeningStopCue, setSessionMuted]);

  const finishAutoStopAfterTranscript = useCallback(() => {
    logVoiceTrace("finishAutoStopAfterTranscript", {
      transcriptPreviewLength: transcriptPreviewRef.current.trim().length,
    });
    clearPendingTranscriptWaitTimeout();
    pendingManualCommitRef.current = false;
    autoStopAfterNextTranscriptRef.current = false;
    beginAutoStopProcessing();
    if (typeof window !== "undefined") {
      clearPendingStopTimeout();
      pendingStopTimeoutRef.current = window.setTimeout(() => {
        pendingStopTimeoutRef.current = null;
        autoStopProcessingStartedRef.current = false;
        dispatch({ type: "connect_succeeded" });
      }, STOP_LISTENING_FINALIZATION_GRACE_MS);
      return;
    }
    autoStopProcessingStartedRef.current = false;
    dispatch({ type: "connect_succeeded" });
  }, [
    beginAutoStopProcessing,
    clearPendingStopTimeout,
    clearPendingTranscriptWaitTimeout,
    logVoiceTrace,
  ]);

  const handleFinalTranscript = useCallback(
    (transcript: string) => {
      const normalizedTranscript = transcript.trim();
      logVoiceTrace("handleFinalTranscript", {
        transcriptLength: normalizedTranscript.length,
        transcriptPreviewLength: transcriptPreviewRef.current.trim().length,
        autoStopAfterNextTranscript: autoStopAfterNextTranscriptRef.current,
      });
      if (utteranceHandledRef.current) {
        if (autoStopAfterNextTranscriptRef.current) {
          clearSilenceFallbackTimeouts();
          finishAutoStopAfterTranscript();
        }
        return;
      }

      utteranceHandledRef.current = true;
      clearPendingTranscriptWaitTimeout();
      clearSilenceFallbackTimeouts();
      dispatch({ type: "listening_started" });
      if (!normalizedTranscript) {
        if (autoStopAfterNextTranscriptRef.current) {
          finishAutoStopAfterTranscript();
        }
        return;
      }
      if (!liveRepliesEnabled) {
        dispatch({ type: "live_reply_interrupted" });
      } else {
        pendingLiveReplyRef.current = true;
      }
      void Promise.resolve(onFinalTranscriptRef.current(normalizedTranscript))
        .then(() => undefined)
        .catch((error: unknown) => {
          dispatch({
            type: "error",
            message: error instanceof Error ? error.message : "Failed to send voice transcript.",
          });
        });
      if (autoStopAfterNextTranscriptRef.current) {
        finishAutoStopAfterTranscript();
      }
    },
    [
      clearPendingTranscriptWaitTimeout,
      clearSilenceFallbackTimeouts,
      finishAutoStopAfterTranscript,
      liveRepliesEnabled,
      logVoiceTrace,
    ],
  );

  const scheduleTranscriptWaitFallback = useCallback(() => {
    logVoiceTrace("scheduleTranscriptWaitFallback", {
      transcriptPreviewLength: transcriptPreviewRef.current.trim().length,
    });
    if (typeof window === "undefined") {
      const transcript = transcriptPreviewRef.current.trim();
      if (transcript) {
        handleFinalTranscript(transcript);
        return;
      }
      finishAutoStopAfterTranscript();
      return;
    }
    clearPendingTranscriptWaitTimeout();
    pendingTranscriptWaitTimeoutRef.current = window.setTimeout(() => {
      pendingTranscriptWaitTimeoutRef.current = null;
      if (utteranceHandledRef.current) {
        return;
      }
      const settledTranscript = transcriptPreviewRef.current.trim();
      if (settledTranscript) {
        handleFinalTranscript(settledTranscript);
        return;
      }
      finishAutoStopAfterTranscript();
    }, PUSH_TO_TALK_TRANSCRIPT_WAIT_MS);
  }, [
    clearPendingTranscriptWaitTimeout,
    finishAutoStopAfterTranscript,
    handleFinalTranscript,
    logVoiceTrace,
  ]);

  const interruptLiveReply = useCallback(() => {
    const session = sessionRef.current;
    if (!session) {
      dispatch({ type: "live_reply_interrupted" });
      return;
    }
    session.interrupt();
    liveReplyResponseIdsRef.current.clear();
    pendingResponseCreateRef.current = false;
    pendingLiveReplyRef.current = false;
    queuedAssistantSpeechRef.current = [];
    dispatch({ type: "live_reply_interrupted" });
  }, []);

  const createAssistantResponse = useCallback((session: RealtimeSession, instructions: string) => {
    pendingResponseCreateRef.current = true;
    session.transport.sendEvent({
      type: "response.create",
      response: {
        instructions,
        modalities: ["audio"],
      },
    });
  }, []);

  const configureCaptureMode = useCallback(
    (session: RealtimeSession, mode: "manual" | "wake") => {
      session.transport.updateSessionConfig({
        audio: {
          input: {
            transcription: {
              model: "gpt-4o-mini-transcribe",
            },
            turnDetection:
              mode === "manual"
                ? null
                : {
                    type: "server_vad",
                    createResponse: liveRepliesEnabled,
                    interruptResponse: true,
                    prefixPaddingMs: 300,
                    silenceDurationMs: resolvedSilenceDurationMs,
                    threshold: 0.5,
                  },
          },
          ...(realtimeVoice ? { output: { voice: realtimeVoice } } : {}),
        },
      });
    },
    [liveRepliesEnabled, realtimeVoice, resolvedSilenceDurationMs],
  );

  const syncBrowserPermissionState = useCallback(async () => {
    if (typeof navigator === "undefined") {
      return;
    }

    if (!("permissions" in navigator) || typeof navigator.permissions.query !== "function") {
      dispatch({ type: "permission_state_changed", permissionState: "unsupported" });
      return;
    }

    try {
      const status = await navigator.permissions.query({
        // TS libdom still omits microphone in some versions.
        name: "microphone" as PermissionName,
      });
      const permissionState =
        status.state === "granted" ? "granted" : status.state === "denied" ? "denied" : "prompt";
      dispatch({ type: "permission_state_changed", permissionState });
    } catch {
      dispatch({ type: "permission_state_changed", permissionState: "unsupported" });
    }
  }, []);

  const ensureMicrophoneAccess = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      dispatch({
        type: "error",
        message: "This browser does not support microphone access.",
      });
      throw new Error("Microphone access is not supported in this browser.");
    }

    await syncBrowserPermissionState();

    try {
      const existingStream = mediaStreamRef.current;
      const existingAudioTrack = existingStream
        ?.getAudioTracks()
        .find((track) => track.readyState === "live");
      if (existingStream && existingAudioTrack) {
        logVoiceTrace("ensureMicrophoneAccess.reuseExistingStream", {
          audioTrackCount: existingStream.getAudioTracks().length,
        });
        setActiveMicrophoneLabel(existingAudioTrack.label.trim() || null);
        dispatch({ type: "permission_state_changed", permissionState: "granted" });
        return existingStream;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: microphoneDeviceId
          ? {
              deviceId: {
                exact: microphoneDeviceId,
              },
            }
          : true,
      });
      logVoiceTrace("ensureMicrophoneAccess.acquiredNewStream", {
        audioTrackCount: stream.getAudioTracks().length,
        microphoneDeviceId: microphoneDeviceId ?? null,
      });
      releaseMediaStream();
      mediaStreamRef.current = stream;
      setActiveMicrophoneLabel(
        stream
          .getAudioTracks()
          .find((track) => track.readyState === "live")
          ?.label.trim() || null,
      );
      dispatch({ type: "permission_state_changed", permissionState: "granted" });
      return stream;
    } catch (error: unknown) {
      dispatch({ type: "permission_state_changed", permissionState: "denied" });
      const message =
        error instanceof Error && error.name === "NotAllowedError"
          ? "Microphone permission was denied. Allow microphone access in your browser and try again."
          : "Unable to access the microphone. Check browser permissions and audio device settings.";
      dispatch({
        type: "error",
        message,
      });
      throw error;
    }
  }, [logVoiceTrace, microphoneDeviceId, releaseMediaStream, syncBrowserPermissionState]);

  const connectSession = useCallback(async () => {
    if (!enabled) {
      throw new Error("Voice input is disabled in settings.");
    }
    if (sessionRef.current) {
      return sessionRef.current;
    }

    dispatch({ type: "connect_requested" });

    try {
      sessionAttemptIdRef.current += 1;
      logVoiceTrace("connectSession.requested", {
        enabled,
        model,
        requestedVoice: voice,
        realtimeVoice,
      });
      const api = ensureNativeApi();
      const token = await api.voice.createRealtimeSession({
        threadId,
        model,
        voice: realtimeVoice,
      });
      logVoiceTrace("connectSession.tokenReceived", {
        tokenExpiresAt: token.expiresAt,
        tokenSessionId: token.sessionId ?? null,
      });
      const mediaStream = mediaStreamRef.current;
      if (!mediaStream) {
        throw new Error("Microphone access is required before starting voice input.");
      }
      const audioElement = ensureAudioElement();
      const transport = new OpenAIRealtimeWebRTC({
        mediaStream,
        ...(audioElement ? { audioElement } : {}),
      });

      const agent = new RealtimeAgent({
        name: "T3 Voice Input",
        instructions:
          "Focus on accurately transcribing the user's speech. Do not invent actions or tool usage.",
      });
      const session = new RealtimeSession(agent, {
        transport,
        ...(model ? { model } : {}),
        config: {
          outputModalities: ["audio"],
          audio: {
            input: {
              transcription: {
                model: "gpt-4o-mini-transcribe",
              },
              turnDetection: {
                type: "server_vad",
                createResponse: liveRepliesEnabled,
                interruptResponse: true,
                prefixPaddingMs: 300,
                silenceDurationMs: resolvedSilenceDurationMs,
                threshold: 0.5,
              },
            },
            ...(realtimeVoice ? { output: { voice: realtimeVoice } } : {}),
          },
        },
      });

      session.on("transport_event", (event) => {
        if (event.type === "response.created") {
          if (
            typeof event.response?.id === "string" &&
            (pendingResponseCreateRef.current || pendingLiveReplyRef.current)
          ) {
            liveReplyResponseIdsRef.current.add(event.response.id);
            dispatch({ type: "live_reply_started" });
          }
          pendingResponseCreateRef.current = false;
          pendingLiveReplyRef.current = false;
          return;
        }

        if (event.type === "output_audio_buffer.started") {
          void audioElementRef.current?.play().catch(() => undefined);
          return;
        }

        if (
          event.type === "response.output_audio_transcript.delta" &&
          typeof event.delta === "string" &&
          typeof event.response_id === "string" &&
          liveReplyResponseIdsRef.current.has(event.response_id)
        ) {
          dispatch({ type: "live_reply_delta", delta: event.delta });
          return;
        }

        if (
          event.type === "response.done" &&
          typeof event.response?.id === "string" &&
          liveReplyResponseIdsRef.current.has(event.response.id)
        ) {
          liveReplyResponseIdsRef.current.delete(event.response.id);
          dispatch({ type: "live_reply_completed" });
          const queuedAssistantSpeech = queuedAssistantSpeechRef.current.shift();
          if (queuedAssistantSpeech && liveReplyResponseIdsRef.current.size === 0) {
            createAssistantResponse(session, queuedAssistantSpeech);
          }
          return;
        }

        if (event.type === "output_audio_buffer.started") {
          void audioElementRef.current?.play().catch(() => undefined);
          return;
        }

        if (event.type === "conversation.item.input_audio_transcription.delta") {
          if (typeof event.delta === "string") {
            transcriptPreviewRef.current = `${transcriptPreviewRef.current}${event.delta}`;
            dispatch({ type: "transcript_delta", delta: event.delta });
          }
          return;
        }

        if (event.type === "input_audio_buffer.committed") {
          logVoiceTrace("transport_event.input_audio_buffer.committed", {
            pendingManualCommit: pendingManualCommitRef.current,
            transcriptPreviewLength: transcriptPreviewRef.current.trim().length,
          });
          if (!pendingManualCommitRef.current) {
            return;
          }
          pendingManualCommitRef.current = false;
          beginAutoStopProcessing();
          scheduleTranscriptWaitFallback();
          return;
        }

        if (event.type === "conversation.item.input_audio_transcription.completed") {
          logVoiceTrace("transport_event.transcription.completed", {
            itemId: event.item_id,
            transcriptLength:
              typeof event.transcript === "string" ? event.transcript.trim().length : 0,
          });
          if (finalizedItemIdsRef.current.has(event.item_id)) {
            return;
          }
          finalizedItemIdsRef.current.add(event.item_id);
          handleFinalTranscript(event.transcript);
          return;
        }

        if (event.type === "conversation.item.input_audio_transcription.failed") {
          const message =
            typeof event.error?.message === "string"
              ? event.error.message
              : "Voice transcription failed.";
          logVoiceError("input_audio_transcription.failed", event);
          dispatch({ type: "error", message });
          return;
        }

        if (event.type === "error") {
          if (isEmptyCommitError(event)) {
            finishAutoStopAfterTranscript();
            return;
          }
          const message =
            typeof event.error?.message === "string"
              ? event.error.message
              : "Voice session encountered an error.";
          logVoiceError("transport_event.error", event);
          dispatch({ type: "error", message });
        }
      });
      session.on("error", (error) => {
        if (isEmptyCommitError(error)) {
          finishAutoStopAfterTranscript();
          return;
        }
        const maybeError = error.error;
        logVoiceError("session.error", error);
        dispatch({
          type: "error",
          message:
            maybeError instanceof Error
              ? maybeError.message
              : typeof maybeError === "string"
                ? maybeError
                : typeof maybeError === "object" &&
                    maybeError !== null &&
                    "message" in maybeError &&
                    typeof maybeError.message === "string"
                  ? maybeError.message
                  : "Voice session encountered an error.",
        });
      });

      await session.connect({ apiKey: token.value, ...(model ? { model } : {}) });
      logVoiceTrace("connectSession.connected", {
        realtimeVoice,
      });
      sessionRef.current = session;
      setSessionMuted(true);
      registerVoiceSession(threadId, () => {
        keepHotMicRef.current = false;
        activeCaptureModeRef.current = "idle";
        pendingManualCommitRef.current = false;
        session.close();
        releaseMediaStream();
        sessionRef.current = null;
        finalizedItemIdsRef.current.clear();
        liveReplyResponseIdsRef.current.clear();
        pendingResponseCreateRef.current = false;
        pendingLiveReplyRef.current = false;
        queuedAssistantSpeechRef.current = [];
        releaseAudioElement();
        dispatch({ type: "reset" });
      });
      dispatch({ type: "connect_succeeded" });
      return session;
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to connect the realtime voice session.";
      logVoiceError("connectSession failed", error);
      dispatch({ type: "error", message });
      throw error;
    }
  }, [
    createAssistantResponse,
    enabled,
    ensureAudioElement,
    beginAutoStopProcessing,
    finishAutoStopAfterTranscript,
    handleFinalTranscript,
    isEmptyCommitError,
    liveRepliesEnabled,
    logVoiceError,
    logVoiceTrace,
    model,
    releaseAudioElement,
    releaseMediaStream,
    resolvedSilenceDurationMs,
    scheduleTranscriptWaitFallback,
    threadId,
    realtimeVoice,
    setSessionMuted,
    voice,
  ]);

  const speakAssistantSummary = useCallback(
    async (summary: string) => {
      const trimmedSummary = summary.trim();
      if (!trimmedSummary || !enabled) {
        return;
      }

      const session = sessionRef.current ?? (await connectSession());
      const instructions = `Read this final provider answer summary naturally without adding new details: ${trimmedSummary}`;
      if (pendingResponseCreateRef.current || liveReplyResponseIdsRef.current.size > 0) {
        queuedAssistantSpeechRef.current.push(instructions);
        return;
      }

      createAssistantResponse(session, instructions);
    },
    [connectSession, createAssistantResponse, enabled],
  );

  const startListeningInternal = useCallback(
    async (options?: { mode?: "manual" | "wake" }) => {
      try {
        clearPendingStopTimeout();
        clearPendingTranscriptWaitTimeout();
        const captureMode = options?.mode ?? "manual";
        captureCycleIdRef.current += 1;
        activeCaptureModeRef.current = captureMode;
        keepHotMicRef.current = captureMode === "manual";
        autoStopAfterNextTranscriptRef.current = !keepHotMicRef.current;
        logVoiceTrace("startListeningInternal", {
          captureMode,
          keepHotMic: keepHotMicRef.current,
          autoStopAfterNextTranscript: autoStopAfterNextTranscriptRef.current,
        });
        await ensureMicrophoneAccess();
        const session = await connectSession();
        configureCaptureMode(session, captureMode);
        session.interrupt();
        liveReplyResponseIdsRef.current.clear();
        pendingResponseCreateRef.current = false;
        pendingLiveReplyRef.current = false;
        dispatch({ type: "live_reply_interrupted" });
        finalizedItemIdsRef.current.clear();
        utteranceHandledRef.current = false;
        autoStopProcessingStartedRef.current = false;
        transcriptPreviewRef.current = "";
        dispatch({ type: "listening_started" });
        setSessionMuted(false);
        playListeningStartCue();
        if (!keepHotMicRef.current && mediaStream) {
          void startVoiceActivityMonitoring(mediaStream, {
            silenceDurationMs: resolvedSilenceDurationMs,
            onSustainedSilence: scheduleSilenceFallback,
          });
        }
        logVoiceTrace("listening_started", { captureMode });
      } catch {
        logVoiceError("startListeningInternal failed", {
          activeCaptureMode: activeCaptureModeRef.current,
        });
        activeCaptureModeRef.current = "idle";
        keepHotMicRef.current = false;
        return;
      }
    },
    [
      clearPendingStopTimeout,
      clearPendingTranscriptWaitTimeout,
      configureCaptureMode,
      connectSession,
      ensureMicrophoneAccess,
      logVoiceError,
      logVoiceTrace,
      playListeningStartCue,
      scheduleSilenceFallback,
      resolvedSilenceDurationMs,
      startVoiceActivityMonitoring,
      setSessionMuted,
    ],
  );

  const startListening = useCallback(async () => {
    await startListeningInternal({
      mode: "manual",
    });
  }, [startListeningInternal]);

  const startWakePhraseListening = useCallback(async () => {
    await startListeningInternal({
      mode: "wake",
    });
  }, [startListeningInternal]);

  const pauseListening = useCallback(() => {
    const session = sessionRef.current;
    if (!session) {
      return;
    }
    setSessionMuted(true);
    dispatch({ type: "connect_succeeded" });
  }, [setSessionMuted]);

  const resumeListening = useCallback(() => {
    const session = sessionRef.current;
    if (!keepHotMicRef.current || !session) {
      return;
    }
    setSessionMuted(false);
    dispatch({ type: "listening_started" });
  }, [setSessionMuted]);

  const stopListening = useCallback(() => {
    const session = sessionRef.current;
    const wasListening = phaseRef.current === "listening";
    const captureMode = activeCaptureModeRef.current;
    logVoiceTrace("stopListening", {
      wasListening,
      captureMode,
      transcriptPreviewLength: transcriptPreviewRef.current.trim().length,
    });
    autoStopAfterNextTranscriptRef.current = wasListening;
    keepHotMicRef.current = false;
    clearSilenceFallbackTimeouts();
    clearPendingStopTimeout();
    clearPendingTranscriptWaitTimeout();
    if (!wasListening) {
      activeCaptureModeRef.current = "idle";
      autoStopProcessingStartedRef.current = false;
      setSessionMuted(true);
      dispatch({ type: "connect_succeeded" });
      return;
    }
    if (captureMode !== "manual") {
      session?.transport.sendEvent({
        type: "input_audio_buffer.commit",
      });
      beginAutoStopProcessing();
      scheduleTranscriptWaitFallback();
      return;
    }
    if (typeof window === "undefined") {
      session?.transport.sendEvent({
        type: "input_audio_buffer.commit",
      });
      beginAutoStopProcessing();
      scheduleTranscriptWaitFallback();
      return;
    }
    pendingStopTimeoutRef.current = window.setTimeout(() => {
      pendingStopTimeoutRef.current = null;
      try {
        pendingManualCommitRef.current = true;
        logVoiceTrace("manualCommit.requested", {
          transcriptPreviewLength: transcriptPreviewRef.current.trim().length,
        });
        session?.transport.sendEvent({
          type: "input_audio_buffer.commit",
        });
      } catch (error: unknown) {
        pendingManualCommitRef.current = false;
        logVoiceError("manual stop commit failed", error);
        dispatch({
          type: "error",
          message: error instanceof Error ? error.message : "Failed to finalize voice input.",
        });
        return;
      }
      pendingTranscriptWaitTimeoutRef.current = window.setTimeout(() => {
        pendingTranscriptWaitTimeoutRef.current = null;
        if (!pendingManualCommitRef.current || utteranceHandledRef.current) {
          return;
        }
        pendingManualCommitRef.current = false;
        logVoiceTrace("manualCommit.timeoutFallback", {
          transcriptPreviewLength: transcriptPreviewRef.current.trim().length,
        });
        beginAutoStopProcessing();
        const settledTranscript = transcriptPreviewRef.current.trim();
        if (settledTranscript) {
          handleFinalTranscript(settledTranscript);
          return;
        }
        finishAutoStopAfterTranscript();
      }, PUSH_TO_TALK_TRANSCRIPT_WAIT_MS);
    }, PUSH_TO_TALK_RELEASE_TAIL_MS);
  }, [
    beginAutoStopProcessing,
    clearPendingStopTimeout,
    clearPendingTranscriptWaitTimeout,
    clearSilenceFallbackTimeouts,
    finishAutoStopAfterTranscript,
    handleFinalTranscript,
    logVoiceError,
    logVoiceTrace,
    scheduleTranscriptWaitFallback,
    setSessionMuted,
  ]);

  useEffect(() => {
    void syncBrowserPermissionState();
  }, [syncBrowserPermissionState]);

  useEffect(() => {
    if (!enabled || state.permissionState !== "granted" || sessionRef.current) {
      return;
    }

    void (async () => {
      try {
        await ensureMicrophoneAccess();
        await connectSession();
      } catch {
        // Leave the session cold if prewarm fails; explicit user actions can retry.
      }
    })();
  }, [connectSession, enabled, ensureMicrophoneAccess, state.permissionState]);

  useEffect(() => closeSession, [closeSession]);

  return {
    ...state,
    activeMicrophoneLabel,
    isListening: state.phase === "listening",
    interruptLiveReply,
    speakAssistantSummary,
    startListening,
    startWakePhraseListening,
    pauseListening,
    resumeListening,
    stopListening,
    closeSession,
  } as const;
}
