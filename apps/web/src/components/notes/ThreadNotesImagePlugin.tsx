import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createParagraphNode,
  $createRangeSelection,
  $insertNodes,
  $isRootOrShadowRoot,
  $setSelection,
  COMMAND_PRIORITY_EDITOR,
  createCommand,
  getDOMSelectionFromTarget,
  type LexicalCommand,
} from "lexical";
import { useEffect } from "react";

import { $createThreadNotesImageNode, ThreadNotesImageNode } from "./ThreadNotesImageNode";

const MAX_THREAD_NOTES_IMAGE_BYTES = 5 * 1024 * 1024;

type InsertThreadNotesImagePayload = Readonly<{
  altText: string;
  src: string;
}>;

export const INSERT_THREAD_NOTES_IMAGE_COMMAND: LexicalCommand<
  InsertThreadNotesImagePayload | ReadonlyArray<InsertThreadNotesImagePayload>
> = createCommand("INSERT_THREAD_NOTES_IMAGE_COMMAND");

function getImageFiles(fileList: FileList | null): File[] {
  if (!fileList) {
    return [];
  }

  return Array.from(fileList).filter((file) => file.type.startsWith("image/"));
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const handleError = () => {
      reject(new Error(`Failed to read '${file.name}'.`));
    };
    const handleLoad = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error(`Failed to read '${file.name}'.`));
    };

    reader.addEventListener("error", handleError, { once: true });
    reader.addEventListener("load", handleLoad, { once: true });

    reader.readAsDataURL(file);
  });
}

async function serializeImageFiles(
  files: File[],
): Promise<Array<{ altText: string; src: string }>> {
  const acceptedFiles: File[] = [];
  const rejectedFileNames: string[] = [];

  for (const file of files) {
    if (file.size > MAX_THREAD_NOTES_IMAGE_BYTES) {
      rejectedFileNames.push(file.name);
      continue;
    }

    acceptedFiles.push(file);
  }

  if (rejectedFileNames.length > 0 && typeof window !== "undefined") {
    const rejectedList = rejectedFileNames.join(", ");
    window.alert(
      `Skipped oversized note images (${rejectedList}). Max size is ${Math.round(MAX_THREAD_NOTES_IMAGE_BYTES / 1024 / 1024)} MB per image.`,
    );
  }

  const serializedSources = await Promise.all(acceptedFiles.map(readFileAsDataUrl));
  return serializedSources.map((src, index) => ({
    altText: acceptedFiles[index]?.name ?? "Dropped image",
    src,
  }));
}

function insertSerializedImages(images: ReadonlyArray<InsertThreadNotesImagePayload>) {
  for (const image of images) {
    const imageNode = $createThreadNotesImageNode(image.src, image.altText);
    $insertNodes([imageNode]);

    if ($isRootOrShadowRoot(imageNode.getParentOrThrow())) {
      if (imageNode.getPreviousSibling() === null) {
        imageNode.insertBefore($createParagraphNode());
      }
      if (imageNode.getNextSibling() === null) {
        imageNode.insertAfter($createParagraphNode());
      }
      const nextSibling = imageNode.getNextSibling();
      if (nextSibling) {
        nextSibling.selectEnd();
      }
    }
  }
}

export function ThreadNotesImagePlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (!editor.hasNodes([ThreadNotesImageNode])) {
      throw new Error("ThreadNotesImagePlugin: image nodes must be registered on the editor");
    }

    const unregisterRootListener = editor.registerRootListener(
      (rootElement, previousRootElement) => {
        if (previousRootElement) {
          previousRootElement.removeEventListener("dragover", onExternalDragOver);
          previousRootElement.removeEventListener("drop", onExternalDrop);
          previousRootElement.removeEventListener("paste", onPaste);
        }

        if (!rootElement) {
          return;
        }

        rootElement.addEventListener("dragover", onExternalDragOver);
        rootElement.addEventListener("drop", onExternalDrop);
        rootElement.addEventListener("paste", onPaste);
      },
    );

    function onExternalDragOver(event: DragEvent) {
      const imageFiles = getImageFiles(event.dataTransfer?.files ?? null);
      if (imageFiles.length === 0) {
        return;
      }

      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
    }

    function onExternalDrop(event: DragEvent) {
      const imageFiles = getImageFiles(event.dataTransfer?.files ?? null);
      if (imageFiles.length === 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      void serializeImageFiles(imageFiles).then((images) => {
        if (images.length === 0) {
          return;
        }

        editor.update(() => {
          const range = getDropRange(event);
          if (range) {
            const rangeSelection = $createRangeSelection();
            rangeSelection.applyDOMRange(range);
            $setSelection(rangeSelection);
          }

          editor.dispatchCommand(INSERT_THREAD_NOTES_IMAGE_COMMAND, images);
        });
      });
    }

    function onPaste(event: ClipboardEvent) {
      const imageFiles = getImageFiles(event.clipboardData?.files ?? null);
      if (imageFiles.length === 0) {
        return;
      }

      event.preventDefault();

      void serializeImageFiles(imageFiles).then((images) => {
        if (images.length === 0) {
          return;
        }

        editor.dispatchCommand(INSERT_THREAD_NOTES_IMAGE_COMMAND, images);
      });
    }

    const unregisterInsertCommand = editor.registerCommand(
      INSERT_THREAD_NOTES_IMAGE_COMMAND,
      (payload) => {
        insertSerializedImages(Array.isArray(payload) ? payload : [payload]);
        return true;
      },
      COMMAND_PRIORITY_EDITOR,
    );

    return () => {
      unregisterInsertCommand();
      unregisterRootListener();
    };
  }, [editor]);

  return null;
}

function getDropRange(event: DragEvent): Range | null | undefined {
  let range: Range | null | undefined;
  const domSelection = getDOMSelectionFromTarget(event.target);

  if (document.caretRangeFromPoint) {
    range = document.caretRangeFromPoint(event.clientX, event.clientY);
  } else if (event.rangeParent && domSelection !== null) {
    domSelection.collapse(event.rangeParent, event.rangeOffset || 0);
    range = domSelection.getRangeAt(0);
  }

  return range;
}

declare global {
  interface DragEvent {
    rangeOffset?: number;
    rangeParent?: Node;
  }
}
