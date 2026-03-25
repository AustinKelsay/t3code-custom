import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  buildExpiredTerminalContextToastCopy,
  buildFinalProviderAnswerSummary,
  extractAssistantNarrationChunks,
  resolveLatestAuthoritativeAssistantMessage,
  resolveLatestNarratableAssistantMessage,
  renderFinalProviderAnswerSummaryForSpeech,
  deriveComposerSendState,
} from "./ChatView.logic";

describe("deriveComposerSendState", () => {
  it("treats expired terminal pills as non-sendable content", () => {
    const state = deriveComposerSendState({
      prompt: "\uFFFC",
      imageCount: 0,
      terminalContexts: [
        {
          id: "ctx-expired",
          threadId: ThreadId.makeUnsafe("thread-1"),
          terminalId: "default",
          terminalLabel: "Terminal 1",
          lineStart: 4,
          lineEnd: 4,
          text: "",
          createdAt: "2026-03-17T12:52:29.000Z",
        },
      ],
    });

    expect(state.trimmedPrompt).toBe("");
    expect(state.sendableTerminalContexts).toEqual([]);
    expect(state.expiredTerminalContextCount).toBe(1);
    expect(state.hasSendableContent).toBe(false);
  });

  it("keeps text sendable while excluding expired terminal pills", () => {
    const state = deriveComposerSendState({
      prompt: `yoo \uFFFC waddup`,
      imageCount: 0,
      terminalContexts: [
        {
          id: "ctx-expired",
          threadId: ThreadId.makeUnsafe("thread-1"),
          terminalId: "default",
          terminalLabel: "Terminal 1",
          lineStart: 4,
          lineEnd: 4,
          text: "",
          createdAt: "2026-03-17T12:52:29.000Z",
        },
      ],
    });

    expect(state.trimmedPrompt).toBe("yoo  waddup");
    expect(state.expiredTerminalContextCount).toBe(1);
    expect(state.hasSendableContent).toBe(true);
  });
});

describe("buildExpiredTerminalContextToastCopy", () => {
  it("formats clear empty-state guidance", () => {
    expect(buildExpiredTerminalContextToastCopy(1, "empty")).toEqual({
      title: "Expired terminal context won't be sent",
      description: "Remove it or re-add it to include terminal output.",
    });
  });

  it("formats omission guidance for sent messages", () => {
    expect(buildExpiredTerminalContextToastCopy(2, "omitted")).toEqual({
      title: "Expired terminal contexts omitted from message",
      description: "Re-add it if you want that terminal output included.",
    });
  });
});

describe("resolveLatestAuthoritativeAssistantMessage", () => {
  it("prefers the completed turn assistant message when present", () => {
    const selected = resolveLatestAuthoritativeAssistantMessage({
      messages: [
        {
          id: "assistant-1" as never,
          role: "assistant",
          text: "Earlier answer",
          createdAt: "2026-03-24T00:00:00.000Z",
          streaming: false,
        },
        {
          id: "assistant-2" as never,
          role: "assistant",
          text: "Turn-complete answer",
          createdAt: "2026-03-24T00:00:01.000Z",
          streaming: false,
        },
      ],
      preferredAssistantMessageId: "assistant-2",
      preferTurnCompletion: true,
    });

    expect(selected?.text).toBe("Turn-complete answer");
  });

  it("falls back to the latest completed assistant message without turn data", () => {
    const selected = resolveLatestAuthoritativeAssistantMessage({
      messages: [
        {
          id: "assistant-1" as never,
          role: "assistant",
          text: "Earlier answer",
          createdAt: "2026-03-24T00:00:00.000Z",
          streaming: false,
        },
        {
          id: "assistant-2" as never,
          role: "assistant",
          text: "Latest answer",
          createdAt: "2026-03-24T00:00:01.000Z",
          streaming: false,
        },
      ],
      preferredAssistantMessageId: null,
      preferTurnCompletion: false,
    });

    expect(selected?.text).toBe("Latest answer");
  });
});

describe("resolveLatestNarratableAssistantMessage", () => {
  it("can return a streaming assistant message", () => {
    const selected = resolveLatestNarratableAssistantMessage({
      messages: [
        {
          id: "assistant-1" as never,
          role: "assistant",
          text: "Streaming answer so far.",
          createdAt: "2026-03-24T00:00:00.000Z",
          streaming: true,
        },
      ],
      preferredAssistantMessageId: null,
      preferTurnCompletion: false,
    });

    expect(selected?.streaming).toBe(true);
    expect(selected?.text).toBe("Streaming answer so far.");
  });
});

describe("buildFinalProviderAnswerSummary", () => {
  it("uses the first two sentences from the first paragraph", () => {
    expect(
      buildFinalProviderAnswerSummary(
        "Updated the README and fixed the failing lint rule. I also tightened the tests.\n\nExtra implementation notes live here.",
      ),
    ).toEqual({
      overview: "Updated the README and fixed the failing lint rule. I also tightened the tests.",
      bulletPoints: [],
    });
  });

  it("truncates long single-paragraph replies", () => {
    const summary = buildFinalProviderAnswerSummary(
      "This is a very long response without strong sentence boundaries that should be shortened for the compact final provider answer preview so it stays readable in the composer area.",
      { maxOverviewLength: 90 },
    );

    expect(summary?.overview.length).toBeLessThanOrEqual(90);
    expect(summary?.overview.endsWith("...")).toBe(true);
  });

  it("strips markdown bullets, headings, links, and code fences", () => {
    expect(
      buildFinalProviderAnswerSummary(
        "# Result\n\n- Fixed the auth bug.\n- Added a regression test.\n\n```ts\nconsole.log('debug');\n```\nSee [details](https://example.com).",
      ),
    ).toEqual({
      overview: "Result Fixed the auth bug. Added a regression test.",
      bulletPoints: ["Fixed the auth bug.", "Added a regression test."],
    });
  });
});

describe("renderFinalProviderAnswerSummaryForSpeech", () => {
  it("combines overview and bullet points into a spoken summary", () => {
    expect(
      renderFinalProviderAnswerSummaryForSpeech({
        overview: "Implemented the login fix.",
        bulletPoints: ["Updated the auth guard.", "Added a regression test."],
      }),
    ).toBe("Implemented the login fix. Updated the auth guard. Added a regression test.");
  });
});

describe("extractAssistantNarrationChunks", () => {
  it("only emits completed sentences while streaming", () => {
    expect(
      extractAssistantNarrationChunks({
        text: "Updated the auth flow. Now adding tests",
        spokenChunkCount: 0,
        isComplete: false,
      }),
    ).toEqual({
      chunks: ["Updated the auth flow."],
      nextSpokenChunkCount: 1,
    });
  });

  it("waits for a solid first sentence before starting streamed readback", () => {
    expect(
      extractAssistantNarrationChunks({
        text: "Sure. Updated the auth flow.",
        spokenChunkCount: 0,
        isComplete: false,
      }),
    ).toEqual({
      chunks: [],
      nextSpokenChunkCount: 0,
    });
  });

  it("emits the trailing fragment once the message is complete", () => {
    expect(
      extractAssistantNarrationChunks({
        text: "Updated the auth flow. Now adding tests",
        spokenChunkCount: 1,
        isComplete: true,
      }),
    ).toEqual({
      chunks: ["Now adding tests"],
      nextSpokenChunkCount: 2,
    });
  });
});
