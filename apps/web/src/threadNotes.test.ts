import { describe, expect, it } from "vitest";

import { appendThreadNoteSelectionToPrompt } from "./threadNotes";

describe("threadNotes", () => {
  it("appends note selections to an existing prompt with spacing", () => {
    expect(appendThreadNoteSelectionToPrompt("Existing draft", "Queued feature")).toBe(
      "Existing draft\n\nQueued feature",
    );
  });

  it("replaces an empty prompt with the selected note text", () => {
    expect(appendThreadNoteSelectionToPrompt("", "Queued feature")).toBe("Queued feature");
  });
});
