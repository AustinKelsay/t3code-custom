import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const DEFAULT_WAKE_PHRASE = "hey t3";
const WAKE_PHRASE_COOLDOWN_MS = 3000;
const RECOGNITION_RESTART_DELAY_MS = 250;

interface WakePhraseRecognitionEvent {
  readonly resultIndex: number;
  readonly results: ArrayLike<{
    readonly isFinal: boolean;
    readonly length: number;
    readonly item: (index: number) => {
      readonly transcript: string;
    };
    readonly [index: number]: {
      readonly transcript: string;
    };
  }>;
}

interface WakePhraseRecognitionErrorEvent {
  readonly error: string;
}

interface WakePhraseRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives?: number;
  start(): void;
  stop(): void;
  abort(): void;
  addEventListener(type: "result", listener: (event: WakePhraseRecognitionEvent) => void): void;
  addEventListener(type: "error", listener: (event: WakePhraseRecognitionErrorEvent) => void): void;
  addEventListener(type: "end", listener: () => void): void;
  removeEventListener(type: "result", listener: (event: WakePhraseRecognitionEvent) => void): void;
  removeEventListener(
    type: "error",
    listener: (event: WakePhraseRecognitionErrorEvent) => void,
  ): void;
  removeEventListener(type: "end", listener: () => void): void;
}

interface WakePhraseRecognitionConstructor {
  new (): WakePhraseRecognition;
}

declare global {
  interface Window {
    webkitSpeechRecognition?: WakePhraseRecognitionConstructor;
    SpeechRecognition?: WakePhraseRecognitionConstructor;
  }
}

interface UseWakePhraseDetectionInput {
  readonly enabled: boolean;
  readonly phrase?: string;
  readonly onWakePhrase: () => void;
}

function normalizeWakeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function expandWakePhraseCandidates(phrase: string): string[] {
  const normalized = normalizeWakeText(phrase);
  const variants = new Set<string>();
  if (normalized.length > 0) {
    variants.add(normalized);
  }

  const withT3Expanded = normalized.replace(/\bt3\b/g, "t three");
  if (withT3Expanded.length > 0) {
    variants.add(withT3Expanded);
  }

  const withT3Compact = normalized.replace(/\bt three\b/g, "t3");
  if (withT3Compact.length > 0) {
    variants.add(withT3Compact);
  }

  for (const variant of Array.from(variants)) {
    variants.add(variant.replace(/\bt three\b/g, "tee three"));
    variants.add(variant.replace(/\bt three\b/g, "tea three"));
    variants.add(variant.replace(/\bt3\b/g, "tee three"));
    variants.add(variant.replace(/\bt3\b/g, "tea three"));
  }

  return Array.from(variants).filter((candidate) => candidate.length > 0);
}

function transcriptMatchesWakePhrase(transcript: string, candidates: readonly string[]): boolean {
  const normalizedTranscript = normalizeWakeText(transcript);
  if (!normalizedTranscript) {
    return false;
  }

  return candidates.some(
    (candidate) =>
      normalizedTranscript.includes(candidate) || normalizedTranscript.endsWith(candidate),
  );
}

export function useWakePhraseDetection(input: UseWakePhraseDetectionInput) {
  const { enabled, phrase = DEFAULT_WAKE_PHRASE, onWakePhrase } = input;
  const [isSupported, setIsSupported] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<WakePhraseRecognition | null>(null);
  const shouldRestartRef = useRef(false);
  const cooldownUntilRef = useRef(0);
  const restartTimeoutRef = useRef<number | null>(null);
  const onWakePhraseRef = useRef(onWakePhrase);

  useEffect(() => {
    onWakePhraseRef.current = onWakePhrase;
  }, [onWakePhrase]);

  const wakePhraseCandidates = useMemo(() => expandWakePhraseCandidates(phrase), [phrase]);

  const stopRecognition = useCallback(() => {
    shouldRestartRef.current = false;
    if (restartTimeoutRef.current !== null && typeof window !== "undefined") {
      window.clearTimeout(restartTimeoutRef.current);
      restartTimeoutRef.current = null;
    }
    const recognition = recognitionRef.current;
    if (!recognition) {
      setIsListening(false);
      return;
    }
    recognition.stop();
    recognitionRef.current = null;
    setIsListening(false);
  }, []);

  useEffect(() => {
    const RecognitionConstructor =
      typeof window === "undefined"
        ? null
        : (window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null);
    setIsSupported(Boolean(RecognitionConstructor));
    if (!enabled || !RecognitionConstructor || wakePhraseCandidates.length === 0) {
      stopRecognition();
      return;
    }

    let cancelled = false;
    const recognition = new RecognitionConstructor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.maxAlternatives = 3;
    recognitionRef.current = recognition;
    shouldRestartRef.current = true;

    const startRecognition = () => {
      if (cancelled) {
        return;
      }
      try {
        recognition.start();
        setIsListening(true);
      } catch {
        setIsListening(false);
      }
    };

    const scheduleRestart = () => {
      if (!shouldRestartRef.current || cancelled || typeof window === "undefined") {
        return;
      }
      if (restartTimeoutRef.current !== null) {
        window.clearTimeout(restartTimeoutRef.current);
      }
      restartTimeoutRef.current = window.setTimeout(() => {
        restartTimeoutRef.current = null;
        startRecognition();
      }, RECOGNITION_RESTART_DELAY_MS);
    };

    const handleResult = (event: WakePhraseRecognitionEvent) => {
      const transcripts: string[] = [];
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (!result) {
          continue;
        }
        for (let alternativeIndex = 0; alternativeIndex < result.length; alternativeIndex += 1) {
          const alternative = result[alternativeIndex];
          if (alternative?.transcript) {
            transcripts.push(alternative.transcript);
          }
        }
      }
      const transcript = transcripts.join(" ").trim();
      if (!transcriptMatchesWakePhrase(transcript, wakePhraseCandidates)) {
        return;
      }
      const now = Date.now();
      if (now < cooldownUntilRef.current) {
        return;
      }
      cooldownUntilRef.current = now + WAKE_PHRASE_COOLDOWN_MS;
      onWakePhraseRef.current();
    };

    const handleError = (event: WakePhraseRecognitionErrorEvent) => {
      setIsListening(false);
      // Recognition often stops itself on transient conditions.
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        shouldRestartRef.current = false;
        return;
      }
      scheduleRestart();
    };

    const handleEnd = () => {
      setIsListening(false);
      if (!shouldRestartRef.current || cancelled) {
        return;
      }
      scheduleRestart();
    };

    recognition.addEventListener("result", handleResult);
    recognition.addEventListener("error", handleError);
    recognition.addEventListener("end", handleEnd);

    startRecognition();

    return () => {
      cancelled = true;
      recognition.removeEventListener("result", handleResult);
      recognition.removeEventListener("error", handleError);
      recognition.removeEventListener("end", handleEnd);
      stopRecognition();
    };
  }, [enabled, stopRecognition, wakePhraseCandidates]);

  return {
    isSupported,
    isListening,
    wakePhrase: wakePhraseCandidates[0] ?? DEFAULT_WAKE_PHRASE,
  } as const;
}
