interface LiveVoiceReplyPreviewProps {
  readonly phase: "idle" | "speaking" | "complete";
  readonly transcript: string;
}

export function LiveVoiceReplyPreview(props: LiveVoiceReplyPreviewProps) {
  const { phase, transcript } = props;

  if (phase === "idle" && !transcript) {
    return null;
  }

  const label = phase === "speaking" ? "Live voice reply" : "Last live voice reply";
  const body =
    transcript ||
    (phase === "speaking"
      ? "Speaking a brief provisional response..."
      : "Live voice reply completed.");

  return (
    <div className="mb-3 rounded-xl border border-sky-500/20 bg-sky-500/5 px-3 py-2">
      <div className="mb-1 text-[11px] uppercase tracking-[0.16em] text-sky-200/80">{label}</div>
      <div className="min-h-5 text-sm text-foreground/85">{body}</div>
    </div>
  );
}
