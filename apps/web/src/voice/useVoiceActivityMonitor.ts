import { useCallback, useRef } from "react";

const DEFAULT_SPEECH_THRESHOLD = 0.02;

interface VoiceActivityMonitorOptions {
  readonly silenceDurationMs: number;
  readonly onSpeechStart?: () => void;
  readonly onSustainedSilence: () => void;
}

export function useVoiceActivityMonitor() {
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const frameRef = useRef<number | null>(null);
  const dataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const heardSpeechRef = useRef(false);
  const lastSpeechAtRef = useRef(0);

  const stopMonitoring = useCallback(() => {
    if (typeof window !== "undefined" && frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    sourceRef.current?.disconnect();
    analyserRef.current?.disconnect();
    sourceRef.current = null;
    analyserRef.current = null;
    dataRef.current = null;
    heardSpeechRef.current = false;
    lastSpeechAtRef.current = 0;
  }, []);

  const ensureAudioContext = useCallback(async () => {
    if (typeof window === "undefined" || typeof window.AudioContext === "undefined") {
      return null;
    }
    const existing = audioContextRef.current;
    if (existing) {
      if (existing.state === "suspended") {
        await existing.resume().catch(() => undefined);
      }
      return existing;
    }
    const audioContext = new window.AudioContext();
    audioContextRef.current = audioContext;
    if (audioContext.state === "suspended") {
      await audioContext.resume().catch(() => undefined);
    }
    return audioContext;
  }, []);

  const startMonitoring = useCallback(
    async (stream: MediaStream, options: VoiceActivityMonitorOptions) => {
      stopMonitoring();
      const audioContext = await ensureAudioContext();
      if (!audioContext) {
        return;
      }

      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      analyserRef.current = analyser;
      sourceRef.current = source;
      dataRef.current = new Uint8Array(analyser.fftSize);

      const tick = () => {
        const analyserNode = analyserRef.current;
        const samples = dataRef.current;
        if (!analyserNode || !samples) {
          return;
        }

        analyserNode.getByteTimeDomainData(samples);
        let sumSquares = 0;
        for (let index = 0; index < samples.length; index += 1) {
          const normalized = (samples[index]! - 128) / 128;
          sumSquares += normalized * normalized;
        }
        const rms = Math.sqrt(sumSquares / samples.length);
        const now = Date.now();

        if (rms >= DEFAULT_SPEECH_THRESHOLD) {
          if (!heardSpeechRef.current) {
            heardSpeechRef.current = true;
            options.onSpeechStart?.();
          }
          lastSpeechAtRef.current = now;
        } else if (
          heardSpeechRef.current &&
          lastSpeechAtRef.current > 0 &&
          now - lastSpeechAtRef.current >= options.silenceDurationMs
        ) {
          stopMonitoring();
          options.onSustainedSilence();
          return;
        }

        frameRef.current = window.requestAnimationFrame(tick);
      };

      frameRef.current = window.requestAnimationFrame(tick);
    },
    [ensureAudioContext, stopMonitoring],
  );

  return {
    startMonitoring,
    stopMonitoring,
  } as const;
}
