import { describe, expect, it } from "vitest";

import {
  isSerializedThreadNotesEditorState,
  resolveThreadNotesInitialEditorState,
} from "./threadNotesEditorState";

describe("threadNotesEditorState", () => {
  it("treats serialized Lexical state as current notes content", () => {
    const serializedState = JSON.stringify({
      root: {
        children: [],
        direction: null,
        format: "",
        indent: 0,
        type: "root",
        version: 1,
      },
    });

    expect(isSerializedThreadNotesEditorState(serializedState)).toBe(true);
    expect(resolveThreadNotesInitialEditorState(serializedState)).toEqual({
      editorState: serializedState,
      shouldMigrateLegacyNotes: false,
    });
  });

  it("treats plain text notes as legacy content that needs migration", () => {
    const resolvedState = resolveThreadNotesInitialEditorState("- queued feature idea");

    expect(isSerializedThreadNotesEditorState("- queued feature idea")).toBe(false);
    expect(typeof resolvedState.editorState).toBe("function");
    expect(resolvedState.shouldMigrateLegacyNotes).toBe(true);
  });
});
