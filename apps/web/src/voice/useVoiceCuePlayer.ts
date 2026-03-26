import { useCallback, useRef } from "react";

interface ToneStep {
  readonly frequency: number;
  readonly durationMs: number;
}

const START_CUE: readonly ToneStep[] = [
  { frequency: 740, durationMs: 70 },
  { frequency: 880, durationMs: 90 },
];

const STOP_CUE: readonly ToneStep[] = [
  { frequency: 660, durationMs: 90 },
  { frequency: 520, durationMs: 120 },
];

const ATTACK_SECONDS = 0.01;
const RELEASE_SECONDS = 0.05;
const STEP_GAP_SECONDS = 0.015;
const GAIN_VALUE = 0.05;

export function useVoiceCuePlayer() {
  const audioContextRef = useRef<AudioContext | null>(null);

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

  const playCue = useCallback(
    async (steps: readonly ToneStep[]) => {
      const audioContext = await ensureAudioContext();
      if (!audioContext) {
        return;
      }

      let startsAt = audioContext.currentTime + 0.01;
      for (const step of steps) {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(step.frequency, startsAt);
        gainNode.gain.setValueAtTime(0, startsAt);
        gainNode.gain.linearRampToValueAtTime(
          GAIN_VALUE,
          startsAt + Math.min(ATTACK_SECONDS, step.durationMs / 1000),
        );

        const stopAt = startsAt + step.durationMs / 1000;
        gainNode.gain.setValueAtTime(GAIN_VALUE, Math.max(startsAt, stopAt - RELEASE_SECONDS));
        gainNode.gain.linearRampToValueAtTime(0, stopAt);

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        oscillator.start(startsAt);
        oscillator.stop(stopAt + 0.01);
        startsAt = stopAt + STEP_GAP_SECONDS;
      }
    },
    [ensureAudioContext],
  );

  const playListeningStartCue = useCallback(() => {
    void playCue(START_CUE);
  }, [playCue]);

  const playListeningStopCue = useCallback(() => {
    void playCue(STOP_CUE);
  }, [playCue]);

  return {
    playListeningStartCue,
    playListeningStopCue,
  } as const;
}
