import type { VoiceSessionPhase } from "@t3tools/contracts";
import { MicIcon, MicOffIcon, TriangleAlertIcon } from "lucide-react";

import { cn } from "~/lib/utils";

const PHASE_LABELS: Record<VoiceSessionPhase, string> = {
  idle: "Off",
  connecting: "Voice",
  ready: "Ready",
  listening: "Listening",
  processing: "Processing",
  error: "Error",
};

export function VoiceStatusBadge(props: { readonly phase: VoiceSessionPhase }) {
  const { phase } = props;
  const Icon = phase === "error" ? TriangleAlertIcon : phase === "idle" ? MicOffIcon : MicIcon;

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium tracking-[0.02em]",
        phase === "error"
          ? "border-rose-500/30 bg-rose-500/8 text-rose-200"
          : phase === "listening"
            ? "border-emerald-500/30 bg-emerald-500/8 text-emerald-200"
            : "border-border/70 bg-background/70 text-muted-foreground/85",
      )}
    >
      <Icon className="size-3" />
      <span className="hidden sm:inline">{PHASE_LABELS[phase]}</span>
    </div>
  );
}
