import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { PaletteIcon, XIcon } from "lucide-react";
import { cn } from "~/lib/utils";

export const COLOR_PICKER_PRESETS = [
  { name: "Black", value: "#171717" },
  { name: "Slate", value: "#334155" },
  { name: "Gray", value: "#6b7280" },
  { name: "Light Gray", value: "#9ca3af" },
  { name: "Silver", value: "#d1d5db" },
  { name: "Red", value: "#ef4444" },
  { name: "Orange", value: "#f97316" },
  { name: "Amber", value: "#f59e0b" },
  { name: "Yellow", value: "#eab308" },
  { name: "Lime", value: "#84cc16" },
  { name: "Green", value: "#22c55e" },
  { name: "Emerald", value: "#10b981" },
  { name: "Teal", value: "#14b8a6" },
  { name: "Cyan", value: "#06b6d4" },
  { name: "Sky", value: "#0ea5e9" },
  { name: "Blue", value: "#3b82f6" },
  { name: "Indigo", value: "#6366f1" },
  { name: "Violet", value: "#8b5cf6" },
  { name: "Purple", value: "#a855f7" },
  { name: "Fuchsia", value: "#d946ef" },
  { name: "Pink", value: "#ec4899" },
  { name: "Rose", value: "#f43f5e" },
] as const;

const DEFAULT_CUSTOM_COLOR = "#3b82f6";
const POPOVER_ESTIMATED_WIDTH = 220;
const VIEWPORT_PADDING = 8;
const POPOVER_OFFSET = 6;

interface ColorPickerPopoverProps {
  ariaLabel: string;
  currentColor: string | null;
  onChange: (color: string | null) => void;
  removeLabel?: string;
  title: string;
  triggerClassName?: string;
}

function normalizeColorInputValue(color: string | null) {
  if (color && /^#[0-9a-f]{6}$/i.test(color)) {
    return color.toLowerCase();
  }

  return DEFAULT_CUSTOM_COLOR;
}

function resolvePopoverPosition(
  triggerElement: HTMLButtonElement | null,
  popoverElement: HTMLDivElement | null,
) {
  if (!triggerElement) {
    return undefined;
  }

  const triggerRect = triggerElement.getBoundingClientRect();
  const popoverHeight = popoverElement?.offsetHeight ?? 0;
  const maxLeft = Math.max(
    VIEWPORT_PADDING,
    window.innerWidth - POPOVER_ESTIMATED_WIDTH - VIEWPORT_PADDING,
  );
  const preferredTop = triggerRect.bottom + POPOVER_OFFSET;
  const preferredBottom = triggerRect.top - POPOVER_OFFSET - popoverHeight;
  const top =
    popoverHeight > 0 &&
    preferredTop + popoverHeight > window.innerHeight - VIEWPORT_PADDING &&
    preferredBottom >= VIEWPORT_PADDING
      ? preferredBottom
      : Math.max(
          VIEWPORT_PADDING,
          Math.min(
            preferredTop,
            window.innerHeight - Math.max(popoverHeight, 0) - VIEWPORT_PADDING,
          ),
        );

  return {
    left: Math.max(
      VIEWPORT_PADDING,
      Math.min(triggerRect.right - POPOVER_ESTIMATED_WIDTH, maxLeft),
    ),
    top,
  };
}

export const ColorPickerPopover = memo(function ColorPickerPopover({
  ariaLabel,
  currentColor,
  onChange,
  removeLabel = "Remove color",
  title,
  triggerClassName,
}: ColorPickerPopoverProps) {
  const [open, setOpen] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties | undefined>(undefined);
  const colorInputId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const currentInputColor = normalizeColorInputValue(currentColor);
  const isPresetColor =
    currentColor !== null &&
    COLOR_PICKER_PRESETS.some(
      (preset) => preset.value.toLowerCase() === currentColor.toLowerCase(),
    );

  useLayoutEffect(() => {
    if (!open) {
      setPopoverStyle(undefined);
      return;
    }

    const updatePosition = () => {
      setPopoverStyle(resolvePopoverPosition(triggerRef.current, popoverRef.current));
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  const handleToggle = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setOpen((previous) => !previous);
  }, []);

  const handleSelectColor = useCallback(
    (event: React.MouseEvent, color: string) => {
      event.preventDefault();
      event.stopPropagation();
      onChange(color);
      setOpen(false);
    },
    [onChange],
  );

  const handleClear = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      onChange(null);
      setOpen(false);
    },
    [onChange],
  );

  const handleCustomColorChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      event.preventDefault();
      event.stopPropagation();
      onChange(event.target.value.toLowerCase());
    },
    [onChange],
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleOutside = (event: MouseEvent | TouchEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(event.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("touchstart", handleOutside);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("touchstart", handleOutside);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-md p-0 text-muted-foreground/70 hover:bg-secondary hover:text-foreground sm:size-5",
          triggerClassName,
        )}
        title={title}
        aria-label={ariaLabel}
        onClick={handleToggle}
      >
        {currentColor ? (
          <span className="size-2.5 rounded-full" style={{ backgroundColor: currentColor }} />
        ) : (
          <PaletteIcon className="size-3.5" />
        )}
      </button>
      {open ? (
        <div
          ref={popoverRef}
          className="fixed z-50 w-[min(13.75rem,calc(100vw-1rem))] rounded-lg border border-border bg-popover p-2 shadow-lg"
          style={popoverStyle}
        >
          <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-6">
            {COLOR_PICKER_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                className={cn(
                  "size-7 rounded-md border-2 transition-all hover:scale-110 active:scale-95 sm:size-6",
                  currentColor?.toLowerCase() === preset.value.toLowerCase()
                    ? "border-foreground ring-1 ring-foreground"
                    : "border-transparent",
                )}
                style={{ backgroundColor: preset.value }}
                title={preset.name}
                aria-label={`Set color to ${preset.name}`}
                onClick={(event) => {
                  handleSelectColor(event, preset.value);
                }}
              />
            ))}
          </div>
          <div className="mt-2 rounded-md border border-border/70 bg-background/70 p-2">
            <div className="mb-1 flex items-center justify-between gap-2">
              <label htmlFor={colorInputId} className="text-[11px] font-medium text-foreground/85">
                Custom color
              </label>
              {currentColor && !isPresetColor ? (
                <span className="text-[10px] text-muted-foreground">{currentColor}</span>
              ) : null}
            </div>
            <input
              id={colorInputId}
              type="color"
              value={currentInputColor}
              className="h-8 w-full cursor-pointer rounded-md border border-border bg-transparent p-1"
              aria-label="Choose a custom color"
              onChange={handleCustomColorChange}
            />
          </div>
          {currentColor ? (
            <button
              type="button"
              className="mt-2 flex w-full items-center justify-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground active:bg-accent"
              onClick={handleClear}
            >
              <XIcon className="size-3" />
              {removeLabel}
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
});
