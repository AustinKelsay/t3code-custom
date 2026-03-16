import type { InitialEditorStateType } from "@lexical/react/LexicalComposer";
import { $createParagraphNode, $createTextNode, $getRoot } from "lexical";

function createPlainTextEditorState(notes: string): InitialEditorStateType {
  return (editor) => {
    editor.update(() => {
      const root = $getRoot();
      root.clear();

      const lines = notes.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
      for (const line of lines) {
        const paragraph = $createParagraphNode();
        if (line.length > 0) {
          paragraph.append($createTextNode(line));
        }
        root.append(paragraph);
      }
    });
  };
}

export function isSerializedThreadNotesEditorState(notes: string): boolean {
  if (notes.trim().length === 0) {
    return false;
  }

  try {
    const parsed = JSON.parse(notes);
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      "root" in parsed &&
      typeof parsed.root === "object" &&
      parsed.root !== null
    );
  } catch {
    return false;
  }
}

export function resolveThreadNotesInitialEditorState(notes: string): {
  editorState?: InitialEditorStateType;
  shouldMigrateLegacyNotes: boolean;
} {
  if (notes.length === 0) {
    return { shouldMigrateLegacyNotes: false };
  }

  if (isSerializedThreadNotesEditorState(notes)) {
    return {
      editorState: notes,
      shouldMigrateLegacyNotes: false,
    };
  }

  return {
    editorState: createPlainTextEditorState(notes),
    shouldMigrateLegacyNotes: true,
  };
}
