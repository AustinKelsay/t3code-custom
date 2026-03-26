import { AudioLinesIcon, MicIcon, SkipForward, SquareIcon, Volume2, VolumeX } from "lucide-react";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

interface VoiceControlsGroupProps {
  readonly phase: "idle" | "connecting" | "ready" | "listening" | "processing" | "error";
  readonly permissionState: "unknown" | "prompt" | "granted" | "denied" | "unsupported";
  readonly micDisabled: boolean;
  readonly wakePhraseEnabled: boolean;
  readonly wakePhraseSupported: boolean;
  readonly speakerEnabled: boolean;
  readonly playbackRateLabel: string;
  readonly speakerDisabled?: boolean;
  readonly skipDisabled?: boolean;
  readonly playbackRateDisabled?: boolean;
  readonly onStart: () => void;
  readonly onStop: () => void;
  readonly onToggleSpeaker: () => void;
  readonly onToggleWakePhrase: () => void;
  readonly onCyclePlaybackRate: () => void;
  readonly onSkip: () => void;
}

export function VoiceControlsGroup(props: VoiceControlsGroupProps) {
  const {
    phase,
    permissionState,
    micDisabled,
    wakePhraseEnabled,
    wakePhraseSupported,
    speakerEnabled,
    playbackRateLabel,
    speakerDisabled = false,
    skipDisabled = false,
    playbackRateDisabled = false,
    onStart,
    onStop,
    onToggleSpeaker,
    onToggleWakePhrase,
    onCyclePlaybackRate,
    onSkip,
  } = props;

  const listening = phase === "listening";
  const micLabel =
    phase === "connecting"
      ? "Connecting voice"
      : phase === "processing"
        ? "Processing voice"
        : listening
          ? "Stop voice input"
          : "Start voice input";
  const micClassName = cn(
    "h-9 w-9 shrink-0 rounded-none border-0 shadow-none sm:h-6 sm:w-6",
    listening
      ? "bg-primary text-primary-foreground hover:bg-primary/90"
      : phase === "error" || permissionState === "denied"
        ? "text-rose-300 hover:text-rose-100"
        : phase === "ready"
          ? "text-emerald-300 hover:text-emerald-100"
          : "text-muted-foreground/70 hover:text-foreground/80",
  );
  const utilityButtonClassName = "h-9 w-9 shrink-0 rounded-none border-0 shadow-none sm:h-6 sm:w-6";

  return (
    <div className="inline-flex shrink-0 overflow-hidden rounded-md border border-input bg-popover shadow-xs/5 dark:bg-input/32">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="outline"
              className={micClassName}
              size="icon-sm"
              type="button"
              onClick={listening ? onStop : onStart}
              disabled={micDisabled || phase === "connecting" || phase === "processing"}
              title={micLabel}
              aria-label={micLabel}
            >
              {listening ? <SquareIcon /> : <MicIcon />}
            </Button>
          }
        />
        <TooltipPopup side="bottom">{micLabel}</TooltipPopup>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              className={cn(
                utilityButtonClassName,
                "border-l border-input text-foreground hover:bg-accent/50",
                wakePhraseEnabled && "bg-accent text-accent-foreground hover:bg-accent/85",
              )}
              variant="ghost"
              size="icon-sm"
              onClick={onToggleWakePhrase}
              aria-label={
                wakePhraseEnabled ? "Disable Hey T3 wake mode" : "Enable Hey T3 wake mode"
              }
              disabled={!wakePhraseSupported}
            >
              <AudioLinesIcon className="size-3" />
            </Button>
          }
        />
        <TooltipPopup side="bottom">
          {wakePhraseSupported
            ? wakePhraseEnabled
              ? "Disable Hey T3 wake mode"
              : "Enable Hey T3 wake mode"
            : "Wake phrase mode is not supported in this browser"}
        </TooltipPopup>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              className={cn(
                utilityButtonClassName,
                "border-l border-input text-foreground hover:bg-accent/50",
              )}
              variant="ghost"
              size="icon-sm"
              onClick={onToggleSpeaker}
              aria-label={speakerEnabled ? "Mute voice follow-ups" : "Unmute voice follow-ups"}
              disabled={speakerDisabled}
            >
              {speakerEnabled ? <Volume2 className="size-3" /> : <VolumeX className="size-3" />}
            </Button>
          }
        />
        <TooltipPopup side="bottom">
          {speakerEnabled
            ? "Mute spoken assistant replies"
            : "Speak assistant replies as they stream"}
        </TooltipPopup>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              className={cn(
                "hidden h-9 shrink-0 rounded-none border-0 border-l border-input px-3 text-xs font-medium shadow-none sm:inline-flex sm:h-6 sm:px-2 sm:text-[11px]",
                "text-foreground hover:bg-accent/50",
              )}
              variant="ghost"
              size="xs"
              onClick={onCyclePlaybackRate}
              aria-label={`Voice speed ${playbackRateLabel}`}
              disabled={playbackRateDisabled}
            >
              {playbackRateLabel}
            </Button>
          }
        />
        <TooltipPopup side="bottom">Cycle voice playback speed</TooltipPopup>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              className={cn(
                utilityButtonClassName,
                "hidden border-l border-input text-foreground hover:bg-accent/50 sm:inline-flex",
              )}
              variant="ghost"
              size="icon-sm"
              onClick={onSkip}
              aria-label="Skip spoken sentence"
              disabled={skipDisabled}
            >
              <SkipForward className="size-3" />
            </Button>
          }
        />
        <TooltipPopup side="bottom">Skip to the next spoken sentence</TooltipPopup>
      </Tooltip>
    </div>
  );
}
