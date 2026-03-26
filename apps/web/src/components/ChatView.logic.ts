import { ProjectId, type ThreadId } from "@t3tools/contracts";
import { type ChatMessage, type Thread } from "../types";
import { randomUUID } from "~/lib/utils";
import { type ComposerImageAttachment, type DraftThreadState } from "../composerDraftStore";
import { Schema } from "effect";
import {
  filterTerminalContextsWithText,
  stripInlineTerminalContextPlaceholders,
  type TerminalContextDraft,
} from "../lib/terminalContext";

export const LAST_INVOKED_SCRIPT_BY_PROJECT_KEY = "t3code:last-invoked-script-by-project";
const WORKTREE_BRANCH_PREFIX = "t3code";

export const LastInvokedScriptByProjectSchema = Schema.Record(ProjectId, Schema.String);

export function buildLocalDraftThread(
  threadId: ThreadId,
  draftThread: DraftThreadState,
  fallbackModel: string,
  error: string | null,
): Thread {
  return {
    id: threadId,
    codexThreadId: null,
    projectId: draftThread.projectId,
    targetId: draftThread.targetId,
    title: "New thread",
    model: fallbackModel,
    runtimeMode: draftThread.runtimeMode,
    interactionMode: draftThread.interactionMode,
    session: null,
    messages: [],
    error,
    createdAt: draftThread.createdAt,
    latestTurn: null,
    lastVisitedAt: draftThread.createdAt,
    branch: draftThread.branch,
    worktreePath: draftThread.worktreePath,
    turnDiffSummaries: [],
    activities: [],
    proposedPlans: [],
  };
}

export function revokeBlobPreviewUrl(previewUrl: string | undefined): void {
  if (!previewUrl || typeof URL === "undefined" || !previewUrl.startsWith("blob:")) {
    return;
  }
  URL.revokeObjectURL(previewUrl);
}

export function revokeUserMessagePreviewUrls(message: ChatMessage): void {
  if (message.role !== "user" || !message.attachments) {
    return;
  }
  for (const attachment of message.attachments) {
    if (attachment.type !== "image") {
      continue;
    }
    revokeBlobPreviewUrl(attachment.previewUrl);
  }
}

export function collectUserMessageBlobPreviewUrls(message: ChatMessage): string[] {
  if (message.role !== "user" || !message.attachments) {
    return [];
  }
  const previewUrls: string[] = [];
  for (const attachment of message.attachments) {
    if (attachment.type !== "image") continue;
    if (!attachment.previewUrl || !attachment.previewUrl.startsWith("blob:")) continue;
    previewUrls.push(attachment.previewUrl);
  }
  return previewUrls;
}

export type SendPhase = "idle" | "preparing-worktree" | "sending-turn";

export interface PullRequestDialogState {
  initialReference: string | null;
  key: number;
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Could not read image data."));
    });
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("Failed to read image."));
    });
    reader.readAsDataURL(file);
  });
}

export function buildTemporaryWorktreeBranchName(): string {
  // Keep the 8-hex suffix shape for backend temporary-branch detection.
  const token = randomUUID().slice(0, 8).toLowerCase();
  return `${WORKTREE_BRANCH_PREFIX}/${token}`;
}

export function cloneComposerImageForRetry(
  image: ComposerImageAttachment,
): ComposerImageAttachment {
  if (typeof URL === "undefined" || !image.previewUrl.startsWith("blob:")) {
    return image;
  }
  try {
    return {
      ...image,
      previewUrl: URL.createObjectURL(image.file),
    };
  } catch {
    return image;
  }
}

export function deriveComposerSendState(options: {
  prompt: string;
  imageCount: number;
  terminalContexts: ReadonlyArray<TerminalContextDraft>;
}): {
  trimmedPrompt: string;
  sendableTerminalContexts: TerminalContextDraft[];
  expiredTerminalContextCount: number;
  hasSendableContent: boolean;
} {
  const trimmedPrompt = stripInlineTerminalContextPlaceholders(options.prompt).trim();
  const sendableTerminalContexts = filterTerminalContextsWithText(options.terminalContexts);
  const expiredTerminalContextCount =
    options.terminalContexts.length - sendableTerminalContexts.length;
  return {
    trimmedPrompt,
    sendableTerminalContexts,
    expiredTerminalContextCount,
    hasSendableContent:
      trimmedPrompt.length > 0 || options.imageCount > 0 || sendableTerminalContexts.length > 0,
  };
}

export function buildExpiredTerminalContextToastCopy(
  expiredTerminalContextCount: number,
  variant: "omitted" | "empty",
): { title: string; description: string } {
  const count = Math.max(1, Math.floor(expiredTerminalContextCount));
  const noun = count === 1 ? "Expired terminal context" : "Expired terminal contexts";
  if (variant === "empty") {
    return {
      title: `${noun} won't be sent`,
      description: "Remove it or re-add it to include terminal output.",
    };
  }
  return {
    title: `${noun} omitted from message`,
    description: "Re-add it if you want that terminal output included.",
  };
}

export function resolveLatestAuthoritativeAssistantMessage(options: {
  messages: readonly ChatMessage[] | null | undefined;
  preferredAssistantMessageId?: string | null;
  preferTurnCompletion?: boolean;
}): ChatMessage | null {
  const { messages, preferredAssistantMessageId, preferTurnCompletion = true } = options;
  if (!messages || messages.length === 0) {
    return null;
  }

  const completedAssistantMessages = messages.filter(
    (message) =>
      message.role === "assistant" && !message.streaming && message.text.trim().length > 0,
  );
  if (completedAssistantMessages.length === 0) {
    return null;
  }

  if (preferTurnCompletion && preferredAssistantMessageId) {
    const preferredMessage = completedAssistantMessages.find(
      (message) => message.id === preferredAssistantMessageId,
    );
    if (preferredMessage) {
      return preferredMessage;
    }
  }

  return completedAssistantMessages.at(-1) ?? null;
}

export function resolveLatestNarratableAssistantMessage(options: {
  messages: readonly ChatMessage[] | null | undefined;
  preferredAssistantMessageId?: string | null;
  preferTurnCompletion?: boolean;
}): ChatMessage | null {
  const { messages, preferredAssistantMessageId, preferTurnCompletion = true } = options;
  if (!messages || messages.length === 0) {
    return null;
  }

  const assistantMessages = messages.filter(
    (message) => message.role === "assistant" && message.text.trim().length > 0,
  );
  if (assistantMessages.length === 0) {
    return null;
  }

  if (preferTurnCompletion && preferredAssistantMessageId) {
    const preferredMessage = assistantMessages.find(
      (message) => message.id === preferredAssistantMessageId,
    );
    if (preferredMessage) {
      return preferredMessage;
    }
  }

  return assistantMessages.at(-1) ?? null;
}

function collapseSummaryWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function stripSummaryMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/`([^`]+)`/gu, "$1")
    .replace(/^\s{0,3}(?:[-*+]|\d+\.)\s+/gmu, "")
    .replace(/^#{1,6}\s+/gmu, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1");
}

function truncateSummary(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  const truncated = text.slice(0, Math.max(0, maxLength - 3)).trimEnd();
  return `${truncated}...`;
}

function splitSummarySentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

export function extractAssistantNarrationParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/u)
    .map((paragraph) => collapseSummaryWhitespace(stripSummaryMarkdown(paragraph)))
    .filter((paragraph) => paragraph.length > 0);
}

export function extractAssistantNarrationSentences(text: string): string[] {
  const normalized = collapseSummaryWhitespace(stripSummaryMarkdown(text));
  if (!normalized) {
    return [];
  }
  const sentences = splitSummarySentences(normalized);
  return sentences.length > 0 ? sentences : [normalized];
}

export function resolveNarrationParagraphForSentence(
  fullText: string,
  sentence: string | null | undefined,
): string | null {
  const normalizedSentence = collapseSummaryWhitespace(stripSummaryMarkdown(sentence ?? ""));
  if (!normalizedSentence) {
    return null;
  }
  const paragraphs = extractAssistantNarrationParagraphs(fullText);
  return (
    paragraphs.find((paragraph) => paragraph.includes(normalizedSentence)) ??
    paragraphs.find((paragraph) => normalizedSentence.includes(paragraph)) ??
    null
  );
}

function extractSummaryBullets(text: string, maxItems: number): string[] {
  const bullets = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^([-*+]|\d+\.)\s+/u.test(line))
    .map((line) => stripSummaryMarkdown(line))
    .map((line) => collapseSummaryWhitespace(line))
    .filter((line) => line.length > 0);

  return bullets.slice(0, maxItems);
}

export interface FinalProviderAnswerSummary {
  overview: string;
  bulletPoints: string[];
}

export function renderFinalProviderAnswerSummaryForSpeech(
  summary: FinalProviderAnswerSummary | null,
): string {
  if (!summary) {
    return "";
  }

  const parts = [summary.overview, ...summary.bulletPoints].filter((part) => part.length > 0);
  return collapseSummaryWhitespace(parts.join(" "));
}

export function extractAssistantNarrationChunks(options: {
  text: string;
  spokenChunkCount: number;
  isComplete: boolean;
}): { chunks: string[]; nextSpokenChunkCount: number } {
  const normalized = collapseSummaryWhitespace(stripSummaryMarkdown(options.text));
  if (!normalized) {
    return { chunks: [], nextSpokenChunkCount: options.spokenChunkCount };
  }

  const sentences = splitSummarySentences(normalized);
  if (sentences.length === 0) {
    return options.isComplete
      ? { chunks: [normalized], nextSpokenChunkCount: options.spokenChunkCount + 1 }
      : { chunks: [], nextSpokenChunkCount: options.spokenChunkCount };
  }

  const endsWithSentenceBoundary = /[.!?]["')\]]?\s*$/u.test(normalized);
  const speakableSentences =
    options.isComplete || endsWithSentenceBoundary ? sentences : sentences.slice(0, -1);
  const chunks = speakableSentences.slice(options.spokenChunkCount).filter((sentence, index) => {
    if (options.spokenChunkCount + index > 0) {
      return true;
    }

    const wordCount = sentence.split(/\s+/u).filter((word) => word.length > 0).length;
    return sentence.length >= 24 || wordCount >= 5 || /[.!?]["')\]]$/u.test(sentence);
  });

  return {
    chunks,
    nextSpokenChunkCount: options.spokenChunkCount + chunks.length,
  };
}

export function buildFinalProviderAnswerSummary(
  text: string,
  options: {
    maxOverviewLength?: number;
    maxBulletCount?: number;
    maxBulletLength?: number;
  } = {},
): FinalProviderAnswerSummary | null {
  const { maxOverviewLength = 220, maxBulletCount = 3, maxBulletLength = 120 } = options;
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  const normalizedParagraph = collapseSummaryWhitespace(
    stripSummaryMarkdown(
      trimmed.split(/\n\s*\n/u).find((segment) => segment.trim().length > 0) ?? trimmed,
    ),
  );
  if (!normalizedParagraph) {
    return null;
  }

  const sentences = splitSummarySentences(normalizedParagraph);

  if (sentences.length === 0) {
    return {
      overview: truncateSummary(normalizedParagraph, maxOverviewLength),
      bulletPoints: extractSummaryBullets(trimmed, maxBulletCount).map((bullet) =>
        truncateSummary(bullet, maxBulletLength),
      ),
    };
  }

  const selected: string[] = [];
  for (const sentence of sentences) {
    const nextSummary = collapseSummaryWhitespace([...selected, sentence].join(" "));
    if (selected.length > 0 && nextSummary.length > maxOverviewLength) {
      break;
    }
    selected.push(sentence);
    if (selected.length >= 2) {
      break;
    }
  }

  const overview = truncateSummary(
    collapseSummaryWhitespace(selected.join(" ")) || normalizedParagraph,
    maxOverviewLength,
  );
  const overviewSentences = new Set(splitSummarySentences(overview));
  const bulletPoints = extractSummaryBullets(trimmed, maxBulletCount)
    .map((bullet) => truncateSummary(bullet, maxBulletLength))
    .filter((bullet) => !overviewSentences.has(bullet));

  return {
    overview,
    bulletPoints,
  };
}
