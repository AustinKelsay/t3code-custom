import { AudioLinesIcon } from "lucide-react";

import { cn } from "~/lib/utils";

export function VoiceReadbackSentenceHighlight(props: { readonly sentence: string | null }) {
  const { sentence } = props;
  if (!sentence) {
    return null;
  }

  return (
    <div className="min-w-0 px-1 py-0.5" aria-live="polite">
      <div className="rounded-2xl border border-primary/18 bg-primary/6 px-3 py-2 shadow-xs">
        <div className="flex items-start gap-2">
          <span
            className={cn(
              "mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary",
            )}
          >
            <AudioLinesIcon className="size-3.5" />
          </span>
          <p className="min-w-0 text-sm text-foreground/90 leading-relaxed">
            <span className="font-medium text-primary">Speaking:</span>{" "}
            <span className="rounded-md bg-primary/10 px-1.5 py-0.5">{sentence}</span>
          </p>
        </div>
      </div>
    </div>
  );
}
