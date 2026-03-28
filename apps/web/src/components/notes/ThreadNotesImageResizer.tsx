import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import { useEffect, useRef } from "react";

const RESIZE_DIRECTIONS = {
  east: 1 << 0,
  north: 1 << 3,
  south: 1 << 1,
  west: 1 << 2,
} as const;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function ThreadNotesImageResizer(props: {
  imageRef: RefObject<HTMLImageElement | null>;
  maxWidth?: number;
  onResizeEnd: (width: number, height: number) => void;
  onResizeStart?: () => void;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const userSelectRef = useRef({ priority: "", value: "default" });
  const positionRef = useRef({
    currentHeight: 0,
    currentWidth: 0,
    direction: 0,
    isResizing: false,
    ratio: 1,
    startHeight: 0,
    startWidth: 0,
    startX: 0,
    startY: 0,
  });

  useEffect(() => {
    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
    };
  });

  const minWidth = 120;
  const minHeight = 80;

  const setStartCursor = (direction: number) => {
    const ew = direction === RESIZE_DIRECTIONS.east || direction === RESIZE_DIRECTIONS.west;
    const ns = direction === RESIZE_DIRECTIONS.north || direction === RESIZE_DIRECTIONS.south;
    const nwse =
      ((direction & RESIZE_DIRECTIONS.north) !== 0 && (direction & RESIZE_DIRECTIONS.west) !== 0) ||
      ((direction & RESIZE_DIRECTIONS.south) !== 0 && (direction & RESIZE_DIRECTIONS.east) !== 0);
    const cursorDir = ew ? "ew" : ns ? "ns" : nwse ? "nwse" : "nesw";

    document.body.style.setProperty("cursor", `${cursorDir}-resize`, "important");
    userSelectRef.current.value = document.body.style.getPropertyValue("-webkit-user-select");
    userSelectRef.current.priority = document.body.style.getPropertyPriority("-webkit-user-select");
    document.body.style.setProperty("-webkit-user-select", "none", "important");
  };

  const setEndCursor = () => {
    document.body.style.removeProperty("cursor");
    document.body.style.setProperty(
      "-webkit-user-select",
      userSelectRef.current.value,
      userSelectRef.current.priority,
    );
  };

  const handlePointerMove = (event: PointerEvent) => {
    const image = props.imageRef.current;
    const position = positionRef.current;
    const isHorizontal = position.direction & (RESIZE_DIRECTIONS.east | RESIZE_DIRECTIONS.west);
    const isVertical = position.direction & (RESIZE_DIRECTIONS.south | RESIZE_DIRECTIONS.north);
    const maxWidth =
      props.maxWidth ??
      image?.parentElement?.getBoundingClientRect().width ??
      image?.closest('[contenteditable="true"]')?.getBoundingClientRect().width ??
      800;
    const maxHeight =
      image?.closest('[contenteditable="true"]')?.getBoundingClientRect().height ?? 1200;

    if (!image || !position.isResizing) {
      return;
    }

    if (isHorizontal && isVertical) {
      let diff = Math.floor(position.startX - event.clientX);
      diff = position.direction & RESIZE_DIRECTIONS.east ? -diff : diff;
      const width = clamp(position.startWidth + diff, minWidth, maxWidth);
      const height = Math.max(minHeight, Math.round(width / position.ratio));
      image.style.width = `${width}px`;
      image.style.height = `${height}px`;
      position.currentWidth = width;
      position.currentHeight = height;
      return;
    }

    if (isVertical) {
      let diff = Math.floor(position.startY - event.clientY);
      diff = position.direction & RESIZE_DIRECTIONS.south ? -diff : diff;
      const height = clamp(position.startHeight + diff, minHeight, maxHeight);
      image.style.height = `${height}px`;
      position.currentHeight = height;
      return;
    }

    let diff = Math.floor(position.startX - event.clientX);
    diff = position.direction & RESIZE_DIRECTIONS.east ? -diff : diff;
    const width = clamp(position.startWidth + diff, minWidth, maxWidth);
    image.style.width = `${width}px`;
    position.currentWidth = width;
  };

  const handlePointerUp = () => {
    const image = props.imageRef.current;
    const overlay = overlayRef.current;
    const position = positionRef.current;

    if (!image || !overlay || !position.isResizing) {
      return;
    }

    position.isResizing = false;
    overlay.classList.remove("opacity-100");
    overlay.classList.add("opacity-0");
    setEndCursor();

    props.onResizeEnd(
      Math.round(position.currentWidth || position.startWidth),
      Math.round(position.currentHeight || position.startHeight),
    );

    position.startWidth = 0;
    position.startHeight = 0;
    position.currentWidth = 0;
    position.currentHeight = 0;
    position.startX = 0;
    position.startY = 0;
    position.ratio = 1;
    position.direction = 0;

    document.removeEventListener("pointermove", handlePointerMove);
    document.removeEventListener("pointerup", handlePointerUp);
  };

  const handlePointerDown = (event: ReactPointerEvent, direction: number) => {
    const image = props.imageRef.current;
    const overlay = overlayRef.current;
    if (!image || !overlay) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const { height, width } = image.getBoundingClientRect();
    const position = positionRef.current;
    position.startWidth = width;
    position.startHeight = height;
    position.currentWidth = width;
    position.currentHeight = height;
    position.startX = event.clientX;
    position.startY = event.clientY;
    position.ratio = width / Math.max(height, 1);
    position.direction = direction;
    position.isResizing = true;

    image.style.width = `${width}px`;
    image.style.height = `${height}px`;
    overlay.classList.remove("opacity-0");
    overlay.classList.add("opacity-100");
    setStartCursor(direction);
    props.onResizeStart?.();

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
  };

  return (
    <div className="pointer-events-none absolute inset-0 z-20" ref={overlayRef}>
      <div className="absolute inset-0 rounded-xl ring-2 ring-primary/35" />
      <ResizeHandle
        className="-top-2 -left-2 cursor-nwse-resize"
        onPointerDown={(event) =>
          handlePointerDown(event, RESIZE_DIRECTIONS.north | RESIZE_DIRECTIONS.west)
        }
      />
      <ResizeHandle
        className="-top-2 -right-2 cursor-nesw-resize"
        onPointerDown={(event) =>
          handlePointerDown(event, RESIZE_DIRECTIONS.north | RESIZE_DIRECTIONS.east)
        }
      />
      <ResizeHandle
        className="-bottom-2 -right-2 cursor-nwse-resize"
        onPointerDown={(event) =>
          handlePointerDown(event, RESIZE_DIRECTIONS.south | RESIZE_DIRECTIONS.east)
        }
      />
      <ResizeHandle
        className="-bottom-2 -left-2 cursor-nesw-resize"
        onPointerDown={(event) =>
          handlePointerDown(event, RESIZE_DIRECTIONS.south | RESIZE_DIRECTIONS.west)
        }
      />
    </div>
  );
}

function ResizeHandle(props: {
  className: string;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      className={`pointer-events-auto absolute size-4 rounded-full border border-primary bg-background shadow ${props.className}`}
      onPointerDown={props.onPointerDown}
      role="presentation"
    />
  );
}
