interface VoiceTranscriptPreviewProps {
  readonly transcript: string;
  readonly phase: "idle" | "connecting" | "ready" | "listening" | "processing" | "error";
  readonly errorMessage: string | null;
  readonly permissionState: "unknown" | "prompt" | "granted" | "denied" | "unsupported";
}

export function VoiceTranscriptPreview(props: VoiceTranscriptPreviewProps) {
  const { transcript, phase, errorMessage, permissionState } = props;

  if (phase === "error" && errorMessage) {
    return (
      <div className="mb-3 rounded-xl border border-rose-500/30 bg-rose-500/8 px-3 py-2 text-sm text-rose-200">
        {errorMessage}
      </div>
    );
  }

  if (
    !transcript &&
    phase !== "connecting" &&
    phase !== "processing" &&
    phase !== "ready" &&
    phase !== "listening" &&
    permissionState !== "denied"
  ) {
    return null;
  }

  const label =
    phase === "connecting"
      ? "Connecting voice..."
      : phase === "processing"
        ? "Processing voice..."
        : phase === "ready"
          ? "Voice ready"
          : phase === "listening"
            ? "Listening..."
            : permissionState === "denied"
              ? "Microphone blocked"
              : "Voice input";
  const body =
    transcript ||
    (phase === "connecting"
      ? "Requesting microphone access and opening the realtime voice session."
      : phase === "processing"
        ? "Speech captured. Finalizing transcript now."
        : phase === "ready"
          ? "Microphone is ready. Press the voice button and start speaking."
          : phase === "listening"
            ? "Speak now. Your words will appear here live."
            : permissionState === "denied"
              ? "Allow microphone access in the browser, then press the voice button again."
              : "Voice input is available.");

  return (
    <div className="mb-3 rounded-xl border border-border/70 bg-muted/20 px-3 py-2">
      <div className="mb-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground/70">
        {label}
      </div>
      <div className="min-h-5 text-sm text-foreground/85">{body}</div>
    </div>
  );
}
