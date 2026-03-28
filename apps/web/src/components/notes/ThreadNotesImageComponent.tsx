import type { NodeKey } from "lexical";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useLexicalEditable } from "@lexical/react/useLexicalEditable";
import { useLexicalNodeSelection } from "@lexical/react/useLexicalNodeSelection";
import {
  $createNodeSelection,
  $getNodeByKey,
  $getSelection,
  $isNodeSelection,
  $setSelection,
  CLICK_COMMAND,
  COMMAND_PRIORITY_LOW,
  SELECTION_CHANGE_COMMAND,
} from "lexical";
import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";

import { threadNotesImageDragGhost, THREAD_NOTES_IMAGE_DRAG_MIME } from "./ThreadNotesImageDnd";
import { ThreadNotesImageResizer } from "./ThreadNotesImageResizer";

export function ThreadNotesImageComponent(props: {
  altText: string;
  className: string;
  draggable: boolean;
  dragType?: string;
  dragWrapperClassName?: string;
  inline: boolean;
  nodeKey: NodeKey;
  onResizeEnd?: (width: number, height: number) => void;
  src: string;
  width?: "inherit" | number;
  height?: "inherit" | number;
}) {
  const [editor] = useLexicalComposerContext();
  const [isSelected, setSelected, clearSelection] = useLexicalNodeSelection(props.nodeKey);
  const isEditable = useLexicalEditable();
  const wrapperRef = useRef<HTMLSpanElement | HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const isInNodeSelection = useMemo(
    () =>
      isSelected &&
      editor.getEditorState().read(() => {
        const selection = $getSelection();
        return $isNodeSelection(selection) && selection.has(props.nodeKey);
      }),
    [editor, isSelected, props.nodeKey],
  );

  useEffect(() => {
    const unregisterClickCommand = editor.registerCommand(
      CLICK_COMMAND,
      (event) => {
        const target = event.target;
        if (!(target instanceof Node) || !wrapperRef.current?.contains(target)) {
          return false;
        }

        event.preventDefault();
        if (event.shiftKey) {
          setSelected(!isSelected);
        } else {
          clearSelection();
          setSelected(true);
        }
        editor.getRootElement()?.focus({ preventScroll: true });
        return true;
      },
      COMMAND_PRIORITY_LOW,
    );

    const unregisterSelectionChangeCommand = editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => false,
      COMMAND_PRIORITY_LOW,
    );

    return () => {
      unregisterClickCommand();
      unregisterSelectionChangeCommand();
    };
  }, [clearSelection, editor, isInNodeSelection, isSelected, props.nodeKey, setSelected]);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (wrapperRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setMenuOpen(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [menuOpen]);

  const selectImageNode = () => {
    editor.update(() => {
      const nodeSelection = $createNodeSelection();
      nodeSelection.add(props.nodeKey);
      $setSelection(nodeSelection);
    });
    clearSelection();
    setSelected(true);
  };

  const handleContextMenu = (event: React.MouseEvent<HTMLDivElement | HTMLSpanElement>) => {
    event.preventDefault();
    selectImageNode();
    setMenuPosition({ x: event.clientX, y: event.clientY });
    setMenuOpen(true);
  };

  const handleDragStart = (event: React.DragEvent<HTMLImageElement>) => {
    selectImageNode();
    if (!props.draggable || !event.dataTransfer) {
      return;
    }

    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", "_");
    event.dataTransfer.setData(
      THREAD_NOTES_IMAGE_DRAG_MIME,
      JSON.stringify({
        altText: props.altText,
        key: props.nodeKey,
        src: props.src,
        type: props.dragType ?? "thread-notes-image",
      }),
    );
    event.dataTransfer.setDragImage(threadNotesImageDragGhost, 0, 0);
  };

  const handleMouseDown = () => {
    if (props.draggable) {
      selectImageNode();
    }
  };

  const Container = props.inline ? "span" : "div";
  const wrapperDragProps =
    isEditable && props.draggable
      ? {
          draggable: true,
          onDragStart: handleDragStart as React.DragEventHandler<HTMLDivElement & HTMLSpanElement>,
          onMouseDown: handleMouseDown,
        }
      : {
          onMouseDown: handleMouseDown,
        };

  return (
    <>
      <Container
        className={
          props.inline
            ? "mx-1 inline-flex align-middle"
            : (props.dragWrapperClassName ??
              "relative my-4 inline-block max-w-full cursor-grab active:cursor-grabbing")
        }
        onContextMenu={handleContextMenu}
        ref={wrapperRef as never}
        {...wrapperDragProps}
      >
        <img
          alt={props.altText}
          className={`${props.className} ${
            isSelected ? "border-primary ring-2 ring-primary/35" : "border-border/80"
          }`}
          draggable={isEditable && props.draggable}
          height={typeof props.height === "number" ? props.height : undefined}
          loading="lazy"
          onDragStart={
            isEditable && props.draggable
              ? (handleDragStart as React.DragEventHandler<HTMLImageElement>)
              : undefined
          }
          onMouseDown={handleMouseDown}
          ref={imageRef}
          src={props.src}
          style={{
            height: typeof props.height === "number" ? `${props.height}px` : undefined,
            width: typeof props.width === "number" ? `${props.width}px` : undefined,
          }}
          width={typeof props.width === "number" ? props.width : undefined}
        />
        {!props.inline && isEditable && isSelected && props.onResizeEnd ? (
          <ThreadNotesImageResizer
            imageRef={imageRef}
            onResizeEnd={(width, height) => {
              editor.update(() => {
                props.onResizeEnd?.(width, height);
              });
            }}
          />
        ) : null}
      </Container>
      {menuOpen && menuPosition && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed z-50 min-w-36 overflow-hidden rounded-md border border-border/80 bg-popover p-1 shadow-lg"
              ref={menuRef}
              style={{
                left: menuPosition.x,
                top: menuPosition.y,
              }}
            >
              <button
                className="flex w-full items-center rounded-sm px-2 py-1.5 text-left text-destructive text-sm hover:bg-accent/80"
                onClick={() => {
                  editor.update(() => {
                    $getNodeByKey(props.nodeKey)?.remove();
                  });
                  setMenuOpen(false);
                }}
                type="button"
              >
                Delete image
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
