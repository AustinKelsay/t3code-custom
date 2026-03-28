import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getSelection,
  $isNodeSelection,
  COMMAND_PRIORITY_HIGH,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
} from "lexical";
import { useEffect } from "react";

import { $isThreadNotesImageNode } from "./ThreadNotesImageNode";

function removeSelectedImages(): boolean {
  const selection = $getSelection();
  if (!$isNodeSelection(selection)) {
    return false;
  }

  const imageNodes = selection.getNodes().filter($isThreadNotesImageNode);
  if (imageNodes.length === 0) {
    return false;
  }

  for (const imageNode of imageNodes) {
    imageNode.remove();
  }

  return true;
}

export function ThreadNotesImageKeyboardPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const unregisterBackspaceCommand = editor.registerCommand(
      KEY_BACKSPACE_COMMAND,
      () => {
        let wasHandled = false;
        editor.update(() => {
          wasHandled = removeSelectedImages();
        });
        return wasHandled;
      },
      COMMAND_PRIORITY_HIGH,
    );

    const unregisterDeleteCommand = editor.registerCommand(
      KEY_DELETE_COMMAND,
      () => {
        let wasHandled = false;
        editor.update(() => {
          wasHandled = removeSelectedImages();
        });
        return wasHandled;
      },
      COMMAND_PRIORITY_HIGH,
    );

    return () => {
      unregisterBackspaceCommand();
      unregisterDeleteCommand();
    };
  }, [editor]);

  return null;
}
