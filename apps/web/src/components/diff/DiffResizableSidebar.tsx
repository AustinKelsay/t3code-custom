import { GripVerticalIcon } from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { cn } from "~/lib/utils";

const DEFAULT_MIN_WIDTH = 220;
const DEFAULT_MAX_WIDTH = 520;

function clampWidth(width: number, minWidth: number, maxWidth: number): number {
  return Math.min(maxWidth, Math.max(minWidth, width));
}

function readStoredWidth(
  storageKey: string,
  fallbackWidth: number,
  minWidth: number,
  maxWidth: number,
): number {
  if (typeof window === "undefined") {
    return fallbackWidth;
  }

  const raw = window.localStorage.getItem(storageKey);
  if (raw == null) {
    return fallbackWidth;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? clampWidth(parsed, minWidth, maxWidth) : fallbackWidth;
}

export function DiffResizableSidebar(props: {
  children: ReactNode;
  className?: string;
  defaultWidth: number;
  maxWidth?: number;
  minWidth?: number;
  storageKey: string;
}) {
  const minWidth = props.minWidth ?? DEFAULT_MIN_WIDTH;
  const maxWidth = props.maxWidth ?? DEFAULT_MAX_WIDTH;
  const [width, setWidth] = useState(() => clampWidth(props.defaultWidth, minWidth, maxWidth));
  const resizeStateRef = useRef<{
    moved: boolean;
    pointerId: number;
    rafId: number | null;
    startWidth: number;
    startX: number;
  } | null>(null);
  const railRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setWidth(readStoredWidth(props.storageKey, props.defaultWidth, minWidth, maxWidth));
  }, [maxWidth, minWidth, props.defaultWidth, props.storageKey]);

  useEffect(() => {
    return () => {
      const resizeState = resizeStateRef.current;
      if (resizeState && resizeState.rafId !== null) {
        window.cancelAnimationFrame(resizeState.rafId);
      }
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
    };
  }, []);

  const stopResize = useCallback(
    (pointerId: number) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState) {
        return;
      }

      if (resizeState.rafId !== null) {
        window.cancelAnimationFrame(resizeState.rafId);
      }
      resizeStateRef.current = null;

      if (typeof window !== "undefined") {
        window.localStorage.setItem(props.storageKey, String(width));
      }

      const rail = railRef.current;
      if (rail?.hasPointerCapture(pointerId)) {
        rail.releasePointerCapture(pointerId);
      }
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
    },
    [props.storageKey, width],
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      resizeStateRef.current = {
        moved: false,
        pointerId: event.pointerId,
        rafId: null,
        startWidth: width,
        startX: event.clientX,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [width],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState || resizeState.pointerId !== event.pointerId) {
        return;
      }

      event.preventDefault();
      const nextWidth = clampWidth(
        resizeState.startWidth + (event.clientX - resizeState.startX),
        minWidth,
        maxWidth,
      );
      resizeState.moved = resizeState.moved || Math.abs(event.clientX - resizeState.startX) > 2;

      if (resizeState.rafId !== null) {
        window.cancelAnimationFrame(resizeState.rafId);
      }

      resizeState.rafId = window.requestAnimationFrame(() => {
        setWidth(nextWidth);
        const activeState = resizeStateRef.current;
        if (activeState) {
          activeState.rafId = null;
        }
      });
    },
    [maxWidth, minWidth],
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (resizeStateRef.current?.pointerId !== event.pointerId) {
        return;
      }
      event.preventDefault();
      stopResize(event.pointerId);
    },
    [stopResize],
  );

  const handlePointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (resizeStateRef.current?.pointerId !== event.pointerId) {
        return;
      }
      event.preventDefault();
      stopResize(event.pointerId);
    },
    [stopResize],
  );

  return (
    <div className={cn("relative flex min-h-0 shrink-0", props.className)} style={{ width }}>
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{props.children}</div>
      <button
        ref={railRef}
        aria-label="Resize file tree"
        className="absolute top-0 right-0 z-10 hidden h-full w-3 translate-x-1/2 cursor-col-resize items-center justify-center text-muted-foreground/45 transition-colors hover:text-foreground md:flex"
        title="Drag to resize file tree"
        type="button"
        onPointerCancel={handlePointerCancel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border/80" />
        <span className="z-10 rounded-full border border-border/80 bg-background/95 p-0.5 shadow-sm">
          <GripVerticalIcon className="size-3" />
        </span>
      </button>
    </div>
  );
}
