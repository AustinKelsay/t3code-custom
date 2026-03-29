const REALTIME_VOICE_OPTIONS = [
  { value: "", label: "Server default" },
  { value: "alloy", label: "Alloy" },
  { value: "ash", label: "Ash" },
  { value: "ballad", label: "Ballad" },
  { value: "cedar", label: "Cedar" },
  { value: "coral", label: "Coral" },
  { value: "marin", label: "Marin" },
  { value: "sage", label: "Sage" },
  { value: "shimmer", label: "Shimmer" },
  { value: "verse", label: "Verse" },
] as const;

const REALTIME_VOICE_NAMES: ReadonlySet<string> = new Set(
  REALTIME_VOICE_OPTIONS.map((option) => option.value).filter((value) => value.length > 0),
);

export { REALTIME_VOICE_OPTIONS };

export function normalizeRealtimeVoiceName(voice: string | null | undefined): string | null {
  const trimmedVoice = voice?.trim().toLowerCase() ?? "";
  if (!trimmedVoice) {
    return null;
  }
  return REALTIME_VOICE_NAMES.has(trimmedVoice) ? trimmedVoice : null;
}
