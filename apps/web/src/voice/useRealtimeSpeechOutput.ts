import { useCallback, useEffect, useRef, useState } from "react";

import { ensureNativeApi } from "../nativeApi";
import type { ThreadId } from "@t3tools/contracts";

interface UseRealtimeSpeechOutputInput {
  readonly threadId: ThreadId;
  readonly enabled: boolean;
  readonly model: string | null;
  readonly voice: string | null;
  readonly instructions: string | null;
  readonly playbackRate: number;
  readonly onUtteranceStart?: () => void;
  readonly onUtteranceEnd?: () => void;
  readonly onPlaybackProgress?: (state: { text: string; progress: number }) => void;
  readonly onPlaybackIdle?: () => void;
}

export function useRealtimeSpeechOutput(input: UseRealtimeSpeechOutputInput) {
  const {
    threadId,
    enabled,
    model,
    voice,
    instructions,
    playbackRate,
    onUtteranceStart,
    onUtteranceEnd,
    onPlaybackProgress,
    onPlaybackIdle,
  } = input;
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<string[]>([]);
  const utteranceActiveRef = useRef(false);
  const playingRef = useRef(false);
  const pausedRef = useRef(false);
  const synthInFlightRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const prefetchAbortControllerRef = useRef<AbortController | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const prefetchedClipRef = useRef<{
    text: string;
    objectUrl: string;
  } | null>(null);
  const idleFinishTimeoutRef = useRef<number | null>(null);
  const playbackWatchdogTimeoutRef = useRef<number | null>(null);
  const pendingQueueSkipCountRef = useRef(0);
  const currentSkipPendingRef = useRef(false);
  const playbackBlockedRef = useRef(false);
  const blockedPlaybackHadActivityRef = useRef(false);
  const enabledRef = useRef(enabled);
  const modelRef = useRef(model);
  const voiceRef = useRef(voice);
  const instructionsRef = useRef(instructions);
  const playbackRateRef = useRef(playbackRate);
  const onUtteranceStartRef = useRef(onUtteranceStart);
  const onUtteranceEndRef = useRef(onUtteranceEnd);
  const onPlaybackProgressRef = useRef(onPlaybackProgress);
  const onPlaybackIdleRef = useRef(onPlaybackIdle);
  const processQueueRef = useRef<(() => Promise<void>) | null>(null);
  const currentPlaybackTextRef = useRef("");
  const [isPlaybackPaused, setIsPlaybackPaused] = useState(false);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    modelRef.current = model;
  }, [model]);

  useEffect(() => {
    voiceRef.current = voice;
  }, [voice]);

  useEffect(() => {
    instructionsRef.current = instructions;
  }, [instructions]);

  useEffect(() => {
    playbackRateRef.current = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    onUtteranceStartRef.current = onUtteranceStart;
  }, [onUtteranceStart]);

  useEffect(() => {
    onUtteranceEndRef.current = onUtteranceEnd;
  }, [onUtteranceEnd]);

  useEffect(() => {
    onPlaybackProgressRef.current = onPlaybackProgress;
  }, [onPlaybackProgress]);

  useEffect(() => {
    onPlaybackIdleRef.current = onPlaybackIdle;
  }, [onPlaybackIdle]);

  const emitPlaybackIdle = useCallback(() => {
    currentPlaybackTextRef.current = "";
    onPlaybackIdleRef.current?.();
  }, []);

  const emitPlaybackProgress = useCallback((progress: number) => {
    const text = currentPlaybackTextRef.current.trim();
    if (!text) {
      return;
    }
    onPlaybackProgressRef.current?.({
      text,
      progress: Number.isFinite(progress) ? Math.max(0, Math.min(progress, 1)) : 0,
    });
  }, []);

  const applyPlaybackRate = useCallback((audioElement: HTMLAudioElement | null) => {
    if (!audioElement) {
      return;
    }
    const nextRate = playbackRateRef.current;
    audioElement.defaultPlaybackRate = nextRate;
    audioElement.playbackRate = nextRate;
  }, []);

  const ensureAudioElement = useCallback(() => {
    if (typeof document === "undefined") {
      return null;
    }

    if (audioElementRef.current) {
      return audioElementRef.current;
    }

    const audioElement = document.createElement("audio");
    audioElement.autoplay = true;
    audioElement.muted = false;
    audioElement.className = "hidden";
    audioElement.dataset.t3VoiceOutputPlayback = "true";
    audioElement.setAttribute("playsinline", "");
    applyPlaybackRate(audioElement);
    document.body.append(audioElement);
    audioElementRef.current = audioElement;
    return audioElement;
  }, [applyPlaybackRate]);

  const releaseAudioElement = useCallback(() => {
    const audioElement = audioElementRef.current;
    if (!audioElement) {
      return;
    }
    audioElement.pause();
    audioElement.srcObject = null;
    audioElement.removeAttribute("src");
    audioElement.load();
    audioElement.remove();
    audioElementRef.current = null;
  }, []);

  const revokeObjectUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  const revokePrefetchedClip = useCallback(() => {
    const clip = prefetchedClipRef.current;
    if (!clip) {
      return;
    }
    URL.revokeObjectURL(clip.objectUrl);
    prefetchedClipRef.current = null;
  }, []);

  const clearIdleFinishTimeout = useCallback(() => {
    if (idleFinishTimeoutRef.current !== null && typeof window !== "undefined") {
      window.clearTimeout(idleFinishTimeoutRef.current);
      idleFinishTimeoutRef.current = null;
    }
  }, []);

  const clearPlaybackWatchdog = useCallback(() => {
    if (playbackWatchdogTimeoutRef.current !== null && typeof window !== "undefined") {
      window.clearTimeout(playbackWatchdogTimeoutRef.current);
      playbackWatchdogTimeoutRef.current = null;
    }
  }, []);

  const finishUtterance = useCallback(() => {
    clearIdleFinishTimeout();
    clearPlaybackWatchdog();
    if (!utteranceActiveRef.current) {
      return;
    }
    utteranceActiveRef.current = false;
    onUtteranceEndRef.current?.();
  }, [clearIdleFinishTimeout, clearPlaybackWatchdog]);

  const scheduleIdleFinish = useCallback(() => {
    clearIdleFinishTimeout();
    if (typeof window === "undefined") {
      finishUtterance();
      return;
    }
    idleFinishTimeoutRef.current = window.setTimeout(() => {
      idleFinishTimeoutRef.current = null;
      if (playingRef.current || synthInFlightRef.current || queueRef.current.length > 0) {
        return;
      }
      finishUtterance();
    }, 1500);
  }, [clearIdleFinishTimeout, finishUtterance]);

  const closeSession = useCallback(() => {
    queueRef.current = [];
    playingRef.current = false;
    pausedRef.current = false;
    synthInFlightRef.current = false;
    pendingQueueSkipCountRef.current = 0;
    currentSkipPendingRef.current = false;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    prefetchAbortControllerRef.current?.abort();
    prefetchAbortControllerRef.current = null;
    finishUtterance();
    emitPlaybackIdle();
    revokeObjectUrl();
    revokePrefetchedClip();
    releaseAudioElement();
    setIsPlaybackPaused(false);
  }, [
    emitPlaybackIdle,
    finishUtterance,
    releaseAudioElement,
    revokeObjectUrl,
    revokePrefetchedClip,
  ]);

  const synthesizeClip = useCallback(
    async (text: string, signal: AbortSignal) => {
      const api = ensureNativeApi();
      const result = await api.voice.synthesizeSpeech({
        threadId,
        text,
        model: modelRef.current,
        voice: voiceRef.current,
        instructions: instructionsRef.current,
      });
      if (signal.aborted) {
        throw new DOMException("Speech synthesis aborted", "AbortError");
      }

      const binary = atob(result.audioBase64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      const blob = new Blob([bytes], { type: result.mimeType });
      return URL.createObjectURL(blob);
    },
    [threadId],
  );

  const maybePrefetchNextSentence = useCallback(async () => {
    if (
      !enabledRef.current ||
      playbackBlockedRef.current ||
      pausedRef.current ||
      synthInFlightRef.current ||
      prefetchAbortControllerRef.current !== null ||
      prefetchedClipRef.current !== null
    ) {
      return;
    }

    const nextText = queueRef.current[0];
    if (!nextText) {
      return;
    }

    const controller = new AbortController();
    prefetchAbortControllerRef.current = controller;
    try {
      const objectUrl = await synthesizeClip(nextText, controller.signal);
      if (controller.signal.aborted) {
        URL.revokeObjectURL(objectUrl);
        return;
      }
      if (queueRef.current[0] !== nextText || prefetchedClipRef.current !== null) {
        URL.revokeObjectURL(objectUrl);
        return;
      }
      prefetchedClipRef.current = {
        text: nextText,
        objectUrl,
      };
    } catch {
      if (!controller.signal.aborted) {
        revokePrefetchedClip();
      }
    } finally {
      if (prefetchAbortControllerRef.current === controller) {
        prefetchAbortControllerRef.current = null;
      }
    }
  }, [revokePrefetchedClip, synthesizeClip]);

  const processQueue = useCallback(async () => {
    if (
      !enabledRef.current ||
      playbackBlockedRef.current ||
      pausedRef.current ||
      playingRef.current ||
      synthInFlightRef.current
    ) {
      return;
    }
    while (pendingQueueSkipCountRef.current > 0 && queueRef.current.length > 0) {
      queueRef.current.shift();
      pendingQueueSkipCountRef.current -= 1;
    }
    const next = queueRef.current.shift();
    if (!next) {
      pendingQueueSkipCountRef.current = 0;
      currentSkipPendingRef.current = false;
      scheduleIdleFinish();
      emitPlaybackIdle();
      return;
    }

    clearIdleFinishTimeout();
    if (!utteranceActiveRef.current) {
      utteranceActiveRef.current = true;
      onUtteranceStartRef.current?.();
    }

    synthInFlightRef.current = true;
    currentSkipPendingRef.current = false;
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const audioElement = ensureAudioElement();
      if (!audioElement) {
        throw new Error("Audio playback is unavailable in this browser.");
      }
      applyPlaybackRate(audioElement);

      revokeObjectUrl();
      const prefetchedClip = prefetchedClipRef.current;
      if (prefetchedClip && prefetchedClip.text === next) {
        objectUrlRef.current = prefetchedClip.objectUrl;
        prefetchedClipRef.current = null;
      } else {
        if (prefetchedClip) {
          revokePrefetchedClip();
        }
        objectUrlRef.current = await synthesizeClip(next, controller.signal);
      }
      if (controller.signal.aborted) {
        revokeObjectUrl();
        return;
      }

      audioElement.src = objectUrlRef.current;
      currentPlaybackTextRef.current = next;
      emitPlaybackProgress(0);
      applyPlaybackRate(audioElement);
      if (pausedRef.current) {
        playingRef.current = false;
        return;
      }
      playingRef.current = true;
      await audioElement.play();
      void maybePrefetchNextSentence();
    } catch {
      if (controller.signal.aborted) {
        return;
      }
      queueRef.current = [];
      pendingQueueSkipCountRef.current = 0;
      currentSkipPendingRef.current = false;
      emitPlaybackIdle();
      revokeObjectUrl();
      revokePrefetchedClip();
      finishUtterance();
    } finally {
      synthInFlightRef.current = false;
      abortControllerRef.current = null;
      if (controller.signal.aborted && !playingRef.current) {
        void processQueue();
      }
    }
  }, [
    applyPlaybackRate,
    clearIdleFinishTimeout,
    ensureAudioElement,
    emitPlaybackIdle,
    emitPlaybackProgress,
    finishUtterance,
    maybePrefetchNextSentence,
    revokeObjectUrl,
    revokePrefetchedClip,
    scheduleIdleFinish,
    synthesizeClip,
  ]);

  useEffect(() => {
    processQueueRef.current = processQueue;
  }, [processQueue]);

  const schedulePlaybackWatchdog = useCallback(
    (audioElement: HTMLAudioElement) => {
      clearPlaybackWatchdog();
      if (typeof window === "undefined") {
        return;
      }
      const duration = audioElement.duration;
      if (!Number.isFinite(duration) || duration <= 0) {
        return;
      }
      const remainingSeconds = Math.max(0, duration - audioElement.currentTime);
      const playbackRate = Math.max(0.1, audioElement.playbackRate || playbackRateRef.current || 1);
      const timeoutMs = Math.ceil((remainingSeconds / playbackRate) * 1000) + 400;
      playbackWatchdogTimeoutRef.current = window.setTimeout(() => {
        playbackWatchdogTimeoutRef.current = null;
        if (!playingRef.current) {
          return;
        }
        playingRef.current = false;
        revokeObjectUrl();
        void processQueueRef.current?.();
      }, timeoutMs);
    },
    [clearPlaybackWatchdog, revokeObjectUrl],
  );

  useEffect(() => {
    applyPlaybackRate(audioElementRef.current);
  }, [applyPlaybackRate, playbackRate]);

  const speakText = useCallback(
    async (text: string) => {
      const trimmedText = text.trim();
      if (!enabledRef.current || trimmedText.length === 0) {
        return;
      }

      clearIdleFinishTimeout();
      queueRef.current.push(trimmedText);
      if (!playbackBlockedRef.current) {
        void maybePrefetchNextSentence();
        await processQueue();
      }
    },
    [clearIdleFinishTimeout, maybePrefetchNextSentence, processQueue],
  );

  const replaceSpeechQueue = useCallback(
    async (items: readonly string[]) => {
      const normalizedItems = items.map((item) => item.trim()).filter((item) => item.length > 0);
      clearIdleFinishTimeout();
      clearPlaybackWatchdog();
      pendingQueueSkipCountRef.current = 0;
      currentSkipPendingRef.current = false;
      queueRef.current = [...normalizedItems];
      prefetchAbortControllerRef.current?.abort();
      prefetchAbortControllerRef.current = null;
      revokePrefetchedClip();
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      synthInFlightRef.current = false;
      const audioElement = audioElementRef.current;
      if (audioElement) {
        audioElement.pause();
        audioElement.currentTime = 0;
        audioElement.removeAttribute("src");
        audioElement.load();
      }
      playingRef.current = false;
      pausedRef.current = false;
      setIsPlaybackPaused(false);
      revokeObjectUrl();
      emitPlaybackIdle();
      if (queueRef.current.length === 0) {
        finishUtterance();
        return;
      }
      if (!playbackBlockedRef.current) {
        void maybePrefetchNextSentence();
        await processQueue();
      }
    },
    [
      clearIdleFinishTimeout,
      clearPlaybackWatchdog,
      emitPlaybackIdle,
      finishUtterance,
      maybePrefetchNextSentence,
      processQueue,
      revokeObjectUrl,
      revokePrefetchedClip,
    ],
  );

  const advanceToNextSentence = useCallback(() => {
    const audioElement = audioElementRef.current;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    prefetchAbortControllerRef.current?.abort();
    prefetchAbortControllerRef.current = null;
    playingRef.current = false;
    clearIdleFinishTimeout();
    clearPlaybackWatchdog();
    if (audioElement) {
      audioElement.pause();
      audioElement.currentTime = 0;
      audioElement.removeAttribute("src");
      audioElement.load();
    }
    revokeObjectUrl();
    revokePrefetchedClip();
    void processQueue();
  }, [
    clearIdleFinishTimeout,
    clearPlaybackWatchdog,
    processQueue,
    revokeObjectUrl,
    revokePrefetchedClip,
  ]);

  const skipCurrentSentence = useCallback(() => {
    const hasCurrentSentence =
      utteranceActiveRef.current &&
      (playingRef.current || synthInFlightRef.current || pausedRef.current);
    const hasQueuedSentence = queueRef.current.length > 0;
    if (!hasCurrentSentence && !hasQueuedSentence) {
      return;
    }

    if (hasCurrentSentence) {
      if (currentSkipPendingRef.current) {
        pendingQueueSkipCountRef.current += 1;
      } else {
        currentSkipPendingRef.current = true;
      }
      advanceToNextSentence();
      return;
    }

    pendingQueueSkipCountRef.current += 1;
    void processQueue();
  }, [advanceToNextSentence, processQueue]);

  const pauseSpeaking = useCallback(() => {
    const audioElement = audioElementRef.current;
    const hasActiveSentence =
      utteranceActiveRef.current &&
      (playingRef.current ||
        synthInFlightRef.current ||
        pausedRef.current ||
        queueRef.current.length > 0 ||
        prefetchedClipRef.current !== null);
    if (!hasActiveSentence) {
      return false;
    }

    pausedRef.current = true;
    setIsPlaybackPaused(true);
    clearIdleFinishTimeout();
    clearPlaybackWatchdog();
    if (audioElement && playingRef.current) {
      audioElement.pause();
      playingRef.current = false;
    }
    return true;
  }, [clearIdleFinishTimeout, clearPlaybackWatchdog]);

  const resumeSpeaking = useCallback(() => {
    if (!pausedRef.current) {
      return;
    }

    pausedRef.current = false;
    setIsPlaybackPaused(false);
    clearIdleFinishTimeout();
    const audioElement = audioElementRef.current;
    if (audioElement && audioElement.currentSrc) {
      applyPlaybackRate(audioElement);
      playingRef.current = true;
      void audioElement.play().catch(() => {
        playingRef.current = false;
        void processQueueRef.current?.();
      });
      return;
    }

    void processQueueRef.current?.();
  }, [applyPlaybackRate, clearIdleFinishTimeout]);

  const stopSpeaking = useCallback(() => {
    queueRef.current = [];
    playbackBlockedRef.current = false;
    blockedPlaybackHadActivityRef.current = false;
    pausedRef.current = false;
    setIsPlaybackPaused(false);
    synthInFlightRef.current = false;
    pendingQueueSkipCountRef.current = 0;
    currentSkipPendingRef.current = false;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    prefetchAbortControllerRef.current?.abort();
    prefetchAbortControllerRef.current = null;
    playingRef.current = false;
    clearIdleFinishTimeout();
    clearPlaybackWatchdog();
    const audioElement = audioElementRef.current;
    if (audioElement) {
      audioElement.pause();
      audioElement.currentTime = 0;
      audioElement.removeAttribute("src");
      audioElement.load();
    }
    revokeObjectUrl();
    revokePrefetchedClip();
    emitPlaybackIdle();
    finishUtterance();
  }, [
    clearIdleFinishTimeout,
    clearPlaybackWatchdog,
    emitPlaybackIdle,
    finishUtterance,
    revokeObjectUrl,
    revokePrefetchedClip,
  ]);

  const blockSpeaking = useCallback(() => {
    playbackBlockedRef.current = true;
    const wasActive = pauseSpeaking();
    blockedPlaybackHadActivityRef.current = wasActive;
    return wasActive;
  }, [pauseSpeaking]);

  const unblockSpeaking = useCallback(() => {
    if (!playbackBlockedRef.current) {
      return;
    }
    playbackBlockedRef.current = false;
    const shouldResume = blockedPlaybackHadActivityRef.current;
    blockedPlaybackHadActivityRef.current = false;
    if (shouldResume) {
      resumeSpeaking();
      return;
    }
    if (queueRef.current.length > 0 || prefetchedClipRef.current !== null) {
      void maybePrefetchNextSentence();
      void processQueueRef.current?.();
    }
  }, [maybePrefetchNextSentence, resumeSpeaking]);

  useEffect(() => {
    const audioElement = ensureAudioElement();
    if (!audioElement) {
      return;
    }
    const syncPlaybackRate = () => {
      applyPlaybackRate(audioElement);
      const duration = audioElement.duration;
      const progress =
        Number.isFinite(duration) && duration > 0 ? audioElement.currentTime / duration : 0;
      emitPlaybackProgress(progress);
      if (playingRef.current) {
        schedulePlaybackWatchdog(audioElement);
      }
    };
    const handleEnded = () => {
      clearPlaybackWatchdog();
      playingRef.current = false;
      emitPlaybackProgress(1);
      revokeObjectUrl();
      void maybePrefetchNextSentence();
      void processQueue();
    };
    const handleError = () => {
      clearPlaybackWatchdog();
      playingRef.current = false;
      pausedRef.current = false;
      setIsPlaybackPaused(false);
      queueRef.current = [];
      emitPlaybackIdle();
      revokeObjectUrl();
      revokePrefetchedClip();
      finishUtterance();
    };
    const handlePlay = () => {
      syncPlaybackRate();
      schedulePlaybackWatchdog(audioElement);
    };
    audioElement.addEventListener("loadedmetadata", syncPlaybackRate);
    audioElement.addEventListener("canplay", syncPlaybackRate);
    audioElement.addEventListener("play", handlePlay);
    audioElement.addEventListener("timeupdate", syncPlaybackRate);
    audioElement.addEventListener("ended", handleEnded);
    audioElement.addEventListener("error", handleError);
    return () => {
      audioElement.removeEventListener("loadedmetadata", syncPlaybackRate);
      audioElement.removeEventListener("canplay", syncPlaybackRate);
      audioElement.removeEventListener("play", handlePlay);
      audioElement.removeEventListener("timeupdate", syncPlaybackRate);
      audioElement.removeEventListener("ended", handleEnded);
      audioElement.removeEventListener("error", handleError);
    };
  }, [
    applyPlaybackRate,
    clearPlaybackWatchdog,
    emitPlaybackIdle,
    emitPlaybackProgress,
    ensureAudioElement,
    finishUtterance,
    maybePrefetchNextSentence,
    processQueue,
    revokeObjectUrl,
    revokePrefetchedClip,
    schedulePlaybackWatchdog,
  ]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    if (playbackBlockedRef.current) {
      return;
    }
    if (pausedRef.current) {
      resumeSpeaking();
      return;
    }
    if (queueRef.current.length > 0 || prefetchedClipRef.current !== null) {
      void maybePrefetchNextSentence();
      void processQueueRef.current?.();
    }
  }, [enabled, maybePrefetchNextSentence, resumeSpeaking]);

  useEffect(() => {
    if (!enabled) {
      stopSpeaking();
      closeSession();
    }
  }, [closeSession, enabled, stopSpeaking]);

  useEffect(() => closeSession, [closeSession]);

  return {
    isPlaybackPaused,
    replaceSpeechQueue,
    speakText,
    skipCurrentSentence,
    blockSpeaking,
    unblockSpeaking,
    pauseSpeaking,
    resumeSpeaking,
    stopSpeaking,
    closeSession,
  } as const;
}
