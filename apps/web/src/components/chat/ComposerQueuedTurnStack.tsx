import type { OrchestrationQueuedTurn, TurnQueueItemId } from "@t3tools/contracts";
import {
  CircleAlertIcon,
  Clock3Icon,
  RefreshCwIcon,
  SendHorizontalIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

interface QueuedTurnStatusConfig {
  readonly label: string;
  readonly ariaStatus: string;
  readonly Icon: LucideIcon;
  readonly rowClassName: string;
  readonly iconClassName: string;
}

const queuedTurnStatusConfig = {
  pending: {
    label: "Queued",
    ariaStatus: "waiting in queue",
    Icon: Clock3Icon,
    rowClassName: "border-border/60 bg-muted/35 text-muted-foreground",
    iconClassName: "text-muted-foreground/80",
  },
  sending: {
    label: "Sending",
    ariaStatus: "sending from queue",
    Icon: SendHorizontalIcon,
    rowClassName: "border-primary/25 bg-primary/5 text-primary",
    iconClassName: "text-primary",
  },
  failed: {
    label: "Failed",
    ariaStatus: "failed in queue",
    Icon: CircleAlertIcon,
    rowClassName: "border-destructive/25 bg-destructive/5 text-destructive",
    iconClassName: "text-destructive",
  },
} satisfies Record<OrchestrationQueuedTurn["status"], QueuedTurnStatusConfig>;

interface ComposerQueuedTurnStackProps {
  readonly queuedTurns: ReadonlyArray<OrchestrationQueuedTurn>;
  readonly disabled?: boolean;
  readonly onRetryQueuedTurn: (queueItemId: TurnQueueItemId) => void;
  readonly onRemoveQueuedTurn: (queueItemId: TurnQueueItemId) => void;
}

export function ComposerQueuedTurnStack({
  queuedTurns,
  disabled = false,
  onRetryQueuedTurn,
  onRemoveQueuedTurn,
}: ComposerQueuedTurnStackProps) {
  if (queuedTurns.length === 0) {
    return null;
  }

  return (
    <div
      aria-label={
        queuedTurns.length === 1 ? "1 queued message" : `${queuedTurns.length} queued messages`
      }
      className="mx-auto mb-2 flex max-h-40 max-w-208 flex-col gap-1 overflow-y-auto px-0.5"
      data-queued-turn-stack="true"
      role="list"
    >
      {queuedTurns.map((queuedTurn, index) => (
        <ComposerQueuedTurnItem
          key={queuedTurn.queueItemId}
          disabled={disabled}
          index={index}
          queuedTurn={queuedTurn}
          onRemoveQueuedTurn={onRemoveQueuedTurn}
          onRetryQueuedTurn={onRetryQueuedTurn}
        />
      ))}
    </div>
  );
}

function ComposerQueuedTurnItem({
  disabled,
  index,
  queuedTurn,
  onRetryQueuedTurn,
  onRemoveQueuedTurn,
}: {
  readonly disabled: boolean;
  readonly index: number;
  readonly queuedTurn: OrchestrationQueuedTurn;
  readonly onRetryQueuedTurn: (queueItemId: TurnQueueItemId) => void;
  readonly onRemoveQueuedTurn: (queueItemId: TurnQueueItemId) => void;
}) {
  const config = queuedTurnStatusConfig[queuedTurn.status];
  const Icon = config.Icon;
  const queuePosition = index + 1;
  const text = queuedTurn.request.message.text.trim() || "(empty message)";

  return (
    <div
      aria-label={`Queued message ${queuePosition}, ${config.ariaStatus}`}
      className={cn(
        "group/queued-turn flex min-h-7 items-center gap-1.5 rounded-lg border px-2 py-1 shadow-[0_1px_0_rgba(0,0,0,0.03),0_6px_18px_rgba(0,0,0,0.04)]",
        config.rowClassName,
      )}
      data-queued-turn-item="true"
      data-queued-turn-position={queuePosition}
      data-queued-turn-status={queuedTurn.status}
      role="listitem"
    >
      <span
        aria-label={`Queue position ${queuePosition}`}
        className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-md bg-background/70 px-1 text-[10px] font-medium tabular-nums text-muted-foreground shadow-[inset_0_0_0_1px_rgba(0,0,0,0.04)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)]"
      >
        {queuePosition}
      </span>
      <Icon aria-hidden="true" className={cn("size-3 shrink-0", config.iconClassName)} />
      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide">
        {config.label}
      </span>
      <span className="min-w-0 flex-1 truncate text-[11px] leading-5 text-foreground/75">
        {text}
      </span>
      <div className="flex shrink-0 items-center gap-0.5 opacity-80 transition-opacity duration-150 group-hover/queued-turn:opacity-100 group-focus-within/queued-turn:opacity-100">
        {queuedTurn.status === "failed" ? (
          <QueuedTurnIconButton
            disabled={disabled}
            label={`Retry queued message ${queuePosition}`}
            onClick={() => onRetryQueuedTurn(queuedTurn.queueItemId)}
          >
            <RefreshCwIcon className="size-3" />
          </QueuedTurnIconButton>
        ) : null}
        <QueuedTurnIconButton
          disabled={disabled}
          label={`Remove queued message ${queuePosition}`}
          onClick={() => onRemoveQueuedTurn(queuedTurn.queueItemId)}
        >
          <XIcon className="size-3" />
        </QueuedTurnIconButton>
      </div>
    </div>
  );
}

function QueuedTurnIconButton({
  children,
  disabled,
  label,
  onClick,
}: {
  readonly children: ReactNode;
  readonly disabled: boolean;
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            className="rounded-md"
            disabled={disabled}
            onClick={onClick}
            size="icon-xs"
            type="button"
            variant="ghost"
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}
