import type { ThreadId } from "@t3tools/contracts";
import { OpenAIRealtimeWebRTC, RealtimeAgent, RealtimeSession } from "@openai/agents/realtime";
import { useCallback, useEffect, useReducer, useRef } from "react";

import { ensureNativeApi } from "../nativeApi";
import { useVoiceActivityMonitor } from "./useVoiceActivityMonitor";
import { useVoiceCuePlayer } from "./useVoiceCuePlayer";
import { registerVoiceSession, releaseVoiceSession } from "./voiceSessionRegistry";
import { voiceReducer } from "./voiceReducer";
import { DEFAULT_VOICE_UI_STATE } from "./types";

const STOP_LISTENING_FINALIZATION_GRACE_MS = 1500;
const SILENCE_FINALIZATION_SETTLE_MS = 650;
interface UseVoiceSessionInput {
  readonly threadId: ThreadId;
  readonly enabled: boolean;
  readonly wakePhraseEnabled?: boolean;
  readonly liveRepliesEnabled: boolean;
  readonly model: string | null;
  readonly voice: string | null;
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
    silenceDurationMs = 3000,
    onFinalTranscript,
  } = input;
  const [state, dispatch] = useReducer(voiceReducer, DEFAULT_VOICE_UI_STATE);
  const sessionRef = useRef<RealtimeSession | null>(null);
  const finalizedItemIdsRef = useRef(new Set<string>());
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const liveReplyResponseIdsRef = useRef(new Set<string>());
  const pendingResponseCreateRef = useRef(false);
  const pendingLiveReplyRef = useRef(false);
  const queuedAssistantSpeechRef = useRef<string[]>([]);
  const keepHotMicRef = useRef(false);
  const autoStopAfterNextTranscriptRef = useRef(false);
  const pendingStopTimeoutRef = useRef<number | null>(null);
  const silenceFallbackTimeoutRef = useRef<number | null>(null);
  const silenceFallbackFinalizeTimeoutRef = useRef<number | null>(null);
  const phaseRef = useRef(DEFAULT_VOICE_UI_STATE.phase);
  const transcriptPreviewRef = useRef("");
  const utteranceHandledRef = useRef(false);
  const { playListeningStartCue, playListeningStopCue } = useVoiceCuePlayer();
  const onFinalTranscriptRef = useRef(onFinalTranscript);
  const {
    startMonitoring: startVoiceActivityMonitoring,
    stopMonitoring: stopVoiceActivityMonitoring,
  } = useVoiceActivityMonitor();

  useEffect(() => {
    onFinalTranscriptRef.current = onFinalTranscript;
  }, [onFinalTranscript]);

  useEffect(() => {
    phaseRef.current = state.phase;
  }, [state.phase]);

  const clearPendingStopTimeout = useCallback(() => {
    if (pendingStopTimeoutRef.current !== null && typeof window !== "undefined") {
      window.clearTimeout(pendingStopTimeoutRef.current);
      pendingStopTimeoutRef.current = null;
    }
  }, []);

  const clearSilenceFallbackTimeouts = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (silenceFallbackTimeoutRef.current !== null) {
      window.clearTimeout(silenceFallbackTimeoutRef.current);
      silenceFallbackTimeoutRef.current = null;
    }
    if (silenceFallbackFinalizeTimeoutRef.current !== null) {
      window.clearTimeout(silenceFallbackFinalizeTimeoutRef.current);
      silenceFallbackFinalizeTimeoutRef.current = null;
    }
  }, []);

  const setSessionMuted = useCallback((muted: boolean) => {
    const session = sessionRef.current;
    session?.mute(muted);
  }, []);

  const releaseMediaStream = useCallback(() => {
    const stream = mediaStreamRef.current;
    if (!stream) {
      return;
    }
    mediaStreamRef.current = null;
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
    clearSilenceFallbackTimeouts();
    stopVoiceActivityMonitoring();
    keepHotMicRef.current = false;
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
    releaseAudioElement();
    releaseVoiceSession(threadId);
    dispatch({ type: "reset" });
    transcriptPreviewRef.current = "";
    utteranceHandledRef.current = false;
  }, [
    clearPendingStopTimeout,
    clearSilenceFallbackTimeouts,
    releaseAudioElement,
    releaseMediaStream,
    stopVoiceActivityMonitoring,
    threadId,
  ]);

  const finishAutoStopAfterTranscript = useCallback(() => {
    autoStopAfterNextTranscriptRef.current = false;
    keepHotMicRef.current = false;
    stopVoiceActivityMonitoring();
    setSessionMuted(true);
    dispatch({ type: "processing_started" });
    playListeningStopCue();
    if (typeof window !== "undefined") {
      clearPendingStopTimeout();
      pendingStopTimeoutRef.current = window.setTimeout(() => {
        pendingStopTimeoutRef.current = null;
        closeSession();
      }, STOP_LISTENING_FINALIZATION_GRACE_MS);
    } else {
      closeSession();
    }
  }, [
    clearPendingStopTimeout,
    closeSession,
    playListeningStopCue,
    setSessionMuted,
    stopVoiceActivityMonitoring,
  ]);

  const handleFinalTranscript = useCallback(
    (transcript: string) => {
      const normalizedTranscript = transcript.trim();
      if (utteranceHandledRef.current) {
        if (autoStopAfterNextTranscriptRef.current) {
          clearSilenceFallbackTimeouts();
          finishAutoStopAfterTranscript();
        }
        return;
      }

      utteranceHandledRef.current = true;
      clearSilenceFallbackTimeouts();
      stopVoiceActivityMonitoring();
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
      clearSilenceFallbackTimeouts,
      finishAutoStopAfterTranscript,
      liveRepliesEnabled,
      stopVoiceActivityMonitoring,
    ],
  );

  const scheduleSilenceFallback = useCallback(() => {
    if (keepHotMicRef.current || typeof window === "undefined") {
      return;
    }
    clearSilenceFallbackTimeouts();
    if (utteranceHandledRef.current || phaseRef.current !== "listening") {
      return;
    }
    silenceFallbackFinalizeTimeoutRef.current = window.setTimeout(() => {
      silenceFallbackFinalizeTimeoutRef.current = null;
      if (utteranceHandledRef.current) {
        return;
      }
      handleFinalTranscript(transcriptPreviewRef.current);
    }, SILENCE_FINALIZATION_SETTLE_MS);
  }, [clearSilenceFallbackTimeouts, handleFinalTranscript]);

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
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      releaseMediaStream();
      mediaStreamRef.current = stream;
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
  }, [releaseMediaStream, syncBrowserPermissionState]);

  const connectSession = useCallback(async () => {
    if (!enabled) {
      throw new Error("Voice input is disabled in settings.");
    }
    if (sessionRef.current) {
      return sessionRef.current;
    }

    dispatch({ type: "connect_requested" });

    try {
      const api = ensureNativeApi();
      const token = await api.voice.createRealtimeSession({
        threadId,
        model,
        voice,
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
                silenceDurationMs,
                threshold: 0.5,
              },
            },
            ...(voice ? { output: { voice } } : {}),
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

        if (event.type === "conversation.item.input_audio_transcription.completed") {
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
          dispatch({ type: "error", message });
          return;
        }

        if (event.type === "error") {
          const message =
            typeof event.error?.message === "string"
              ? event.error.message
              : "Voice session encountered an error.";
          dispatch({ type: "error", message });
        }
      });
      session.on("error", (error) => {
        const maybeError = error.error;
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
      sessionRef.current = session;
      setSessionMuted(true);
      registerVoiceSession(threadId, () => {
        keepHotMicRef.current = false;
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
      dispatch({ type: "error", message });
      throw error;
    }
  }, [
    createAssistantResponse,
    enabled,
    ensureAudioElement,
    handleFinalTranscript,
    liveRepliesEnabled,
    model,
    releaseAudioElement,
    releaseMediaStream,
    silenceDurationMs,
    threadId,
    voice,
    setSessionMuted,
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
    async (options?: { keepHotMic?: boolean }) => {
      try {
        clearPendingStopTimeout();
        keepHotMicRef.current = options?.keepHotMic ?? true;
        autoStopAfterNextTranscriptRef.current = !keepHotMicRef.current;
        await ensureMicrophoneAccess();
        const mediaStream = mediaStreamRef.current;
        const session = await connectSession();
        session.interrupt();
        liveReplyResponseIdsRef.current.clear();
        pendingResponseCreateRef.current = false;
        pendingLiveReplyRef.current = false;
        dispatch({ type: "live_reply_interrupted" });
        finalizedItemIdsRef.current.clear();
        utteranceHandledRef.current = false;
        transcriptPreviewRef.current = "";
        dispatch({ type: "listening_started" });
        setSessionMuted(false);
        playListeningStartCue();
        if (!keepHotMicRef.current && mediaStream) {
          void startVoiceActivityMonitoring(mediaStream, {
            silenceDurationMs,
            onSustainedSilence: scheduleSilenceFallback,
          });
        }
      } catch {
        return;
      }
    },
    [
      clearPendingStopTimeout,
      connectSession,
      ensureMicrophoneAccess,
      playListeningStartCue,
      scheduleSilenceFallback,
      silenceDurationMs,
      startVoiceActivityMonitoring,
      setSessionMuted,
    ],
  );

  const startListening = useCallback(async () => {
    await startListeningInternal({
      keepHotMic: true,
    });
  }, [startListeningInternal]);

  const startWakePhraseListening = useCallback(async () => {
    await startListeningInternal({
      keepHotMic: false,
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
    const wasListening = phaseRef.current === "listening";
    keepHotMicRef.current = false;
    autoStopAfterNextTranscriptRef.current = false;
    clearSilenceFallbackTimeouts();
    stopVoiceActivityMonitoring();
    setSessionMuted(true);
    dispatch({ type: "connect_succeeded" });
    if (wasListening) {
      playListeningStopCue();
    }
    clearPendingStopTimeout();
    if (typeof window === "undefined") {
      closeSession();
      return;
    }
    pendingStopTimeoutRef.current = window.setTimeout(() => {
      pendingStopTimeoutRef.current = null;
      closeSession();
    }, STOP_LISTENING_FINALIZATION_GRACE_MS);
  }, [
    clearPendingStopTimeout,
    clearSilenceFallbackTimeouts,
    closeSession,
    playListeningStopCue,
    setSessionMuted,
    stopVoiceActivityMonitoring,
  ]);

  useEffect(() => {
    void syncBrowserPermissionState();
  }, [syncBrowserPermissionState]);

  useEffect(() => closeSession, [closeSession]);

  return {
    ...state,
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
