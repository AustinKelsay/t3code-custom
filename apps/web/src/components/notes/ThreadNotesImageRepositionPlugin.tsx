import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getNodeByKey, $getRoot } from "lexical";
import { useEffect, useRef } from "react";

const THREAD_NOTES_IMAGE_DRAG_MIME = "application/x-thread-notes-image-drag";

type DropTarget = Readonly<{
  insertBefore: boolean;
  targetKey: string | null;
}>;

function readDraggedImageKey(event: DragEvent): string | null {
  const payload = event.dataTransfer?.getData(THREAD_NOTES_IMAGE_DRAG_MIME);
  if (!payload) {
    return null;
  }

  try {
    const parsed = JSON.parse(payload) as { key?: string };
    return typeof parsed.key === "string" && parsed.key.length > 0 ? parsed.key : null;
  } catch {
    return null;
  }
}

export function ThreadNotesImageRepositionPlugin(props: { anchorElem: HTMLElement }) {
  const [editor] = useLexicalComposerContext();
  const targetLineRef = useRef<HTMLDivElement | null>(null);
  const dropTargetRef = useRef<DropTarget | null>(null);

  useEffect(() => {
    const line = document.createElement("div");
    line.className =
      "pointer-events-none absolute z-50 hidden h-1 rounded-full bg-primary shadow-[0_0_0_1px_color-mix(in_oklab,var(--color-primary)_50%,transparent),0_0_18px_color-mix(in_oklab,var(--color-primary)_22%,transparent)]";
    targetLineRef.current = line;
    props.anchorElem.append(line);

    const hideTargetLine = () => {
      dropTargetRef.current = null;
      line.style.display = "none";
    };

    const positionTargetLine = (event: DragEvent, draggedKey: string): boolean => {
      const anchorRect = props.anchorElem.getBoundingClientRect();

      const nextDropTarget = editor.getEditorState().read(() => {
        const root = $getRoot();
        const topLevelNodes = root.getChildren();
        let fallbackTarget: DropTarget | null = null;

        for (const topLevelNode of topLevelNodes) {
          if (topLevelNode.getKey() === draggedKey) {
            continue;
          }

          const element = editor.getElementByKey(topLevelNode.getKey());
          if (!element) {
            continue;
          }

          const rect = element.getBoundingClientRect();
          const insertBefore = event.clientY < rect.top + rect.height / 2;

          fallbackTarget = {
            insertBefore: false,
            targetKey: topLevelNode.getKey(),
          };

          if (event.clientY <= rect.bottom) {
            return {
              insertBefore,
              targetKey: topLevelNode.getKey(),
            };
          }
        }

        return fallbackTarget;
      });

      if (!nextDropTarget?.targetKey) {
        hideTargetLine();
        return false;
      }

      const targetElement = editor.getElementByKey(nextDropTarget.targetKey);
      if (!targetElement) {
        hideTargetLine();
        return false;
      }

      const rect = targetElement.getBoundingClientRect();
      const top = nextDropTarget.insertBefore ? rect.top : rect.bottom;

      line.style.display = "block";
      line.style.left = `${rect.left - anchorRect.left}px`;
      line.style.top = `${top - anchorRect.top - 2}px`;
      line.style.width = `${rect.width}px`;
      dropTargetRef.current = nextDropTarget;
      return true;
    };

    const unregisterRootListener = editor.registerRootListener(
      (rootElement, previousRootElement) => {
        if (previousRootElement) {
          previousRootElement.removeEventListener("dragover", onDragOver);
          previousRootElement.removeEventListener("drop", onDrop);
          previousRootElement.removeEventListener("dragleave", onDragLeave);
        }

        if (!rootElement) {
          return;
        }

        rootElement.addEventListener("dragover", onDragOver);
        rootElement.addEventListener("drop", onDrop);
        rootElement.addEventListener("dragleave", onDragLeave);
      },
    );

    function onDragOver(event: DragEvent) {
      const draggedKey = readDraggedImageKey(event);
      if (!draggedKey) {
        return;
      }

      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }
      const hasTarget = positionTargetLine(event, draggedKey);
      console.debug("[notes-image-drag] dragover", {
        clientX: event.clientX,
        clientY: event.clientY,
        draggedKey,
        hasTarget,
        targetKey: dropTargetRef.current?.targetKey ?? null,
      });
    }

    function onDrop(event: DragEvent) {
      const draggedKey = readDraggedImageKey(event);
      const dropTarget = dropTargetRef.current;
      const targetKey = dropTarget?.targetKey;
      if (!draggedKey || !targetKey || !dropTarget) {
        console.debug("[notes-image-drag] drop skipped", {
          draggedKey,
          targetKey,
        });
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      console.debug("[notes-image-drag] drop", {
        draggedKey,
        insertBefore: dropTarget.insertBefore,
        targetKey,
      });

      editor.update(() => {
        const draggedNode = $getNodeByKey(draggedKey);
        const targetNode = $getNodeByKey(targetKey);
        if (!draggedNode || !targetNode || draggedNode === targetNode) {
          console.debug("[notes-image-drag] drop aborted in update", {
            draggedExists: !!draggedNode,
            sameNode: draggedNode === targetNode,
            targetExists: !!targetNode,
          });
          return;
        }

        if (dropTarget.insertBefore) {
          targetNode.insertBefore(draggedNode);
        } else {
          targetNode.insertAfter(draggedNode);
        }
      });

      hideTargetLine();
    }

    function onDragLeave(event: DragEvent) {
      const relatedTarget = event.relatedTarget;
      if (relatedTarget instanceof Node && props.anchorElem.contains(relatedTarget)) {
        return;
      }

      hideTargetLine();
    }

    const handleWindowDragEnd = () => {
      hideTargetLine();
    };

    window.addEventListener("dragend", handleWindowDragEnd);

    return () => {
      unregisterRootListener();
      window.removeEventListener("dragend", handleWindowDragEnd);
      hideTargetLine();
      line.remove();
    };
  }, [editor, props.anchorElem]);

  return null;
}
