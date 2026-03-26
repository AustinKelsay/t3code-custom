import type { FinalProviderAnswerSummary } from "../ChatView.logic";

interface FinalProviderAnswerPreviewProps {
  readonly summary: FinalProviderAnswerSummary | null;
  readonly speakerEnabled: boolean;
}

export function FinalProviderAnswerPreview(props: FinalProviderAnswerPreviewProps) {
  const { summary, speakerEnabled } = props;

  if (!summary) {
    return null;
  }

  return (
    <div className="mb-3 rounded-xl border border-emerald-500/20 bg-emerald-500/6 px-3 py-2">
      <div className="mb-1 flex items-center justify-between gap-3">
        <div className="text-[11px] uppercase tracking-[0.16em] text-emerald-200/85">
          Final provider answer
        </div>
        <div className="text-[10px] text-emerald-100/55">
          {speakerEnabled ? "Voice follow-up on" : "Voice follow-up muted"}
        </div>
      </div>
      <div className="min-h-5 text-sm text-foreground/90">{summary.overview}</div>
      {summary.bulletPoints.length > 0 ? (
        <ul className="mt-2 space-y-1 text-sm text-foreground/85">
          {summary.bulletPoints.map((bullet) => (
            <li key={bullet} className="flex gap-2">
              <span className="mt-[0.1rem] text-emerald-200/80">•</span>
              <span>{bullet}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
