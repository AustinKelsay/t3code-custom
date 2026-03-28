import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $isListItemNode, ListItemNode } from "@lexical/list";
import {
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  KEY_TAB_COMMAND,
  type LexicalNode,
} from "lexical";
import { useEffect } from "react";

function getSelectedListItems(): ListItemNode[] {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) {
    return [];
  }

  const selectedListItems = new Map<string, ListItemNode>();
  for (const selectedNode of selection.getNodes()) {
    let currentNode: LexicalNode | null = selectedNode;
    while (currentNode) {
      if ($isListItemNode(currentNode)) {
        selectedListItems.set(currentNode.getKey(), currentNode);
        break;
      }
      currentNode = currentNode.getParent();
    }
  }

  return [...selectedListItems.values()];
}

export function ThreadNotesListIndentPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand(
      KEY_TAB_COMMAND,
      (event) => {
        let handled = false;

        editor.update(() => {
          const selectedListItems = getSelectedListItems();
          if (selectedListItems.length === 0) {
            return;
          }

          const orderedItems = selectedListItems.toSorted((left, right) =>
            event?.shiftKey
              ? right.getIndent() - left.getIndent()
              : left.getIndent() - right.getIndent(),
          );

          for (const listItem of orderedItems) {
            listItem.setIndent(Math.max(0, listItem.getIndent() + (event?.shiftKey ? -1 : 1)));
          }

          handled = true;
        });

        if (!handled) {
          return false;
        }

        event?.preventDefault();
        event?.stopPropagation();
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor]);

  return null;
}
