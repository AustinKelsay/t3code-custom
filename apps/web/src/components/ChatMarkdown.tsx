import { DiffsHighlighter, getSharedHighlighter, SupportedLanguages } from "@pierre/diffs";
import { CheckIcon, CopyIcon, LoaderCircleIcon, PauseIcon, PlayIcon } from "lucide-react";
import React, {
  Children,
  Suspense,
  isValidElement,
  use,
  useEffect,
  memo,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { openInPreferredEditor } from "../editorPreferences";
import { resolveDiffThemeName, type DiffThemeName } from "../lib/diffRendering";
import { fnv1a32 } from "../lib/diffRendering";
import { LRUCache } from "../lib/lruCache";
import { useTheme } from "../hooks/useTheme";
import { resolveMarkdownFileLinkTarget } from "../markdown-links";
import { readNativeApi } from "../nativeApi";
import MermaidBlock from "./MermaidBlock";

class CodeHighlightErrorBoundary extends React.Component<
  { fallback: ReactNode; children: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { fallback: ReactNode; children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  override render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

interface ChatMarkdownProps {
  text: string;
  cwd: string | undefined;
  isStreaming?: boolean;
  activeSentence?: string | null;
  activeParagraph?: string | null;
  activeParagraphIndex?: number | null;
  isSpeakingPaused?: boolean;
  pendingPlayParagraph?: string | null;
  pendingPlayParagraphIndex?: number | null;
  onPlayParagraph?: (paragraphIndex: number, paragraphText: string) => void;
}

const CODE_FENCE_LANGUAGE_REGEX = /(?:^|\s)language-([^\s]+)/;
const MAX_HIGHLIGHT_CACHE_ENTRIES = 500;
const MAX_HIGHLIGHT_CACHE_MEMORY_BYTES = 50 * 1024 * 1024;
const highlightedCodeCache = new LRUCache<string>(
  MAX_HIGHLIGHT_CACHE_ENTRIES,
  MAX_HIGHLIGHT_CACHE_MEMORY_BYTES,
);
const highlighterPromiseCache = new Map<string, Promise<DiffsHighlighter>>();

function extractFenceLanguage(className: string | undefined): string {
  const match = className?.match(CODE_FENCE_LANGUAGE_REGEX);
  return (match?.[1] ?? "text").toLowerCase();
}

function resolveHighlightLanguage(language: string): string {
  // Shiki doesn't bundle a gitignore grammar; ini is a close match (#685)
  return language === "gitignore" ? "ini" : language;
}

function isMermaidLanguage(language: string): boolean {
  return language === "mermaid" || language === "mmd";
}

function nodeToPlainText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map((child) => nodeToPlainText(child)).join("");
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return nodeToPlainText(node.props.children);
  }
  return "";
}

function normalizeHighlightText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function extractLeadingSentence(text: string): string | null {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }
  const sentences = normalized
    .split(/(?<=[.!?])\s+/u)
    .map((sentence) => sentence.trim())
    .find((sentence) => sentence.length > 0);
  return sentences ?? normalized;
}

function extractCodeBlock(
  children: ReactNode,
): { className: string | undefined; code: string } | null {
  const childNodes = Children.toArray(children);
  if (childNodes.length !== 1) {
    return null;
  }

  const onlyChild = childNodes[0];
  if (
    !isValidElement<{ className?: string; children?: ReactNode }>(onlyChild) ||
    onlyChild.type !== "code"
  ) {
    return null;
  }

  return {
    className: onlyChild.props.className,
    code: nodeToPlainText(onlyChild.props.children),
  };
}

function highlightSentenceInNode(
  node: ReactNode,
  activeSentence: string,
  keyPrefix = "sentence-highlight",
): ReactNode {
  if (!activeSentence.trim()) {
    return node;
  }

  if (typeof node === "string" || typeof node === "number") {
    const value = String(node);
    const matchIndex = value.indexOf(activeSentence);
    if (matchIndex === -1) {
      return node;
    }
    const before = value.slice(0, matchIndex);
    const match = value.slice(matchIndex, matchIndex + activeSentence.length);
    const after = value.slice(matchIndex + activeSentence.length);
    return [
      before,
      <mark
        key={`${keyPrefix}:mark:${matchIndex}`}
        className="rounded-md bg-primary/14 px-1.5 py-0.5 text-foreground ring-1 ring-primary/18"
      >
        {match}
      </mark>,
      after,
    ];
  }

  if (Array.isArray(node)) {
    return node.map((child, index) =>
      highlightSentenceInNode(child, activeSentence, `${keyPrefix}:${index}`),
    );
  }

  if (!isValidElement<{ children?: ReactNode }>(node)) {
    return node;
  }

  if (typeof node.type === "string") {
    const tagName = node.type.toLowerCase();
    if (tagName === "code" || tagName === "pre" || tagName === "kbd" || tagName === "samp") {
      return node;
    }
  }

  const nextChildren = highlightSentenceInNode(
    node.props.children,
    activeSentence,
    `${keyPrefix}:child`,
  );
  if (nextChildren === node.props.children) {
    return node;
  }
  return React.createElement(node.type, { ...node.props }, nextChildren);
}

function createHighlightCacheKey(code: string, language: string, themeName: DiffThemeName): string {
  return `${fnv1a32(code).toString(36)}:${code.length}:${language}:${themeName}`;
}

function estimateHighlightedSize(html: string, code: string): number {
  return Math.max(html.length * 2, code.length * 3);
}

function getHighlighterPromise(language: string): Promise<DiffsHighlighter> {
  const cached = highlighterPromiseCache.get(language);
  if (cached) return cached;

  const promise = getSharedHighlighter({
    themes: [resolveDiffThemeName("dark"), resolveDiffThemeName("light")],
    langs: [language as SupportedLanguages],
    preferredHighlighter: "shiki-js",
  }).catch((err) => {
    highlighterPromiseCache.delete(language);
    if (language === "text") {
      // "text" itself failed — Shiki cannot initialize at all, surface the error
      throw err;
    }
    // Language not supported by Shiki — fall back to "text"
    return getHighlighterPromise("text");
  });
  highlighterPromiseCache.set(language, promise);
  return promise;
}

function MarkdownCodeBlock({ code, children }: { code: string; children: ReactNode }) {
  const { copyToClipboard, isCopied } = useCopyToClipboard();

  return (
    <div className="chat-markdown-codeblock">
      <button
        type="button"
        className="chat-markdown-copy-button"
        onClick={() => copyToClipboard(code)}
        title={isCopied ? "Copied" : "Copy code"}
        aria-label={isCopied ? "Copied" : "Copy code"}
      >
        {isCopied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
      </button>
      {children}
    </div>
  );
}

interface SuspenseShikiCodeBlockProps {
  className: string | undefined;
  code: string;
  themeName: DiffThemeName;
  isStreaming: boolean;
}

function SuspenseShikiCodeBlock({
  className,
  code,
  themeName,
  isStreaming,
}: SuspenseShikiCodeBlockProps) {
  const language = resolveHighlightLanguage(extractFenceLanguage(className));
  const cacheKey = createHighlightCacheKey(code, language, themeName);
  const cachedHighlightedHtml = !isStreaming ? highlightedCodeCache.get(cacheKey) : null;

  if (cachedHighlightedHtml != null) {
    return (
      <div
        className="chat-markdown-shiki"
        dangerouslySetInnerHTML={{ __html: cachedHighlightedHtml }}
      />
    );
  }

  const highlighter = use(getHighlighterPromise(language));
  const highlightedHtml = useMemo(() => {
    try {
      return highlighter.codeToHtml(code, { lang: language, theme: themeName });
    } catch (error) {
      // Log highlighting failures for debugging while falling back to plain text
      console.warn(
        `Code highlighting failed for language "${language}", falling back to plain text.`,
        error instanceof Error ? error.message : error,
      );
      // If highlighting fails for this language, render as plain text
      return highlighter.codeToHtml(code, { lang: "text", theme: themeName });
    }
  }, [code, highlighter, language, themeName]);

  useEffect(() => {
    if (!isStreaming) {
      highlightedCodeCache.set(
        cacheKey,
        highlightedHtml,
        estimateHighlightedSize(highlightedHtml, code),
      );
    }
  }, [cacheKey, code, highlightedHtml, isStreaming]);

  return (
    <div className="chat-markdown-shiki" dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
  );
}

function ChatMarkdown({
  text,
  cwd,
  isStreaming = false,
  activeSentence = null,
  activeParagraph = null,
  activeParagraphIndex = null,
  isSpeakingPaused = false,
  pendingPlayParagraph = null,
  pendingPlayParagraphIndex = null,
  onPlayParagraph,
}: ChatMarkdownProps) {
  const { resolvedTheme } = useTheme();
  const diffThemeName = resolveDiffThemeName(resolvedTheme);
  const [optimisticPendingParagraph, setOptimisticPendingParagraph] = useState<string | null>(null);

  useEffect(() => {
    if (pendingPlayParagraph) {
      setOptimisticPendingParagraph(pendingPlayParagraph);
      return;
    }
    if (activeSentence?.trim()) {
      setOptimisticPendingParagraph(null);
    }
  }, [activeSentence, pendingPlayParagraph]);

  const markdownComponents = useMemo<Components>(() => {
    let paragraphRenderIndex = 0;
    const normalizedActiveSentence = normalizeHighlightText(activeSentence ?? "");
    const normalizedActiveParagraph = normalizeHighlightText(activeParagraph ?? "");
    const paragraphContainsActiveSentence = (children: ReactNode) => {
      if (!normalizedActiveSentence) {
        return false;
      }
      return normalizeHighlightText(nodeToPlainText(children)).includes(normalizedActiveSentence);
    };
    const paragraphMatchesActiveParagraph = (paragraphText: string) => {
      if (!normalizedActiveParagraph) {
        return false;
      }
      return normalizeHighlightText(paragraphText) === normalizedActiveParagraph;
    };
    const renderParagraphPlayButton = (paragraphIndex: number, paragraphText: string) => {
      const normalizedParagraph = nodeToPlainText(paragraphText).trim();
      if (!onPlayParagraph || normalizedParagraph.length === 0) {
        return null;
      }
      const isPending =
        pendingPlayParagraphIndex === paragraphIndex ||
        (pendingPlayParagraphIndex === null && pendingPlayParagraph === normalizedParagraph);
      const isActive =
        activeParagraphIndex === paragraphIndex ||
        paragraphMatchesActiveParagraph(normalizedParagraph);
      const showPending =
        optimisticPendingParagraph === normalizedParagraph ||
        pendingPlayParagraphIndex === paragraphIndex ||
        isPending;
      const showPause = isActive && !showPending && !isSpeakingPaused;
      const showResume = isActive && !showPending && isSpeakingPaused;
      return (
        <button
          type="button"
          className={`relative inline-flex size-6 shrink-0 items-center justify-center rounded-full border transition-opacity sm:size-5 ${
            showPending
              ? "border-primary/50 bg-primary/12 text-primary shadow-sm shadow-primary/15 opacity-100 ring-2 ring-primary/20"
              : showPause || showResume
                ? "border-primary/40 bg-primary/10 text-primary opacity-100"
                : "border-border/55 bg-background/85 text-muted-foreground/70 hover:text-foreground sm:opacity-0 sm:group-hover/voice-paragraph:opacity-100"
          }`}
          onClick={() => {
            if (!showPause && !showResume) {
              setOptimisticPendingParagraph(normalizedParagraph);
            }
            onPlayParagraph(paragraphIndex, normalizedParagraph);
          }}
          aria-label={
            showPending
              ? "Loading paragraph playback"
              : showPause
                ? "Pause paragraph playback"
                : showResume
                  ? "Resume paragraph playback"
                  : "Play from this paragraph"
          }
          title={
            showPending
              ? "Loading paragraph playback"
              : showPause
                ? "Pause paragraph playback"
                : showResume
                  ? "Resume paragraph playback"
                  : "Play from this paragraph"
          }
          aria-busy={showPending}
          disabled={showPending}
        >
          {showPending ? (
            <>
              <span className="absolute inset-0 rounded-full animate-pulse bg-primary/10" />
              <LoaderCircleIcon className="relative z-10 size-3 animate-spin" />
            </>
          ) : showPause ? (
            <PauseIcon className="size-3" />
          ) : (
            <PlayIcon className="size-3" />
          )}
        </button>
      );
    };
    const renderHighlightedChildren = (
      children: ReactNode,
      keyPrefix: string,
      fallbackSentence?: string | null,
    ) => {
      const sentenceToHighlight = activeSentence?.trim() || fallbackSentence?.trim() || "";
      return sentenceToHighlight
        ? highlightSentenceInNode(children, sentenceToHighlight, keyPrefix)
        : children;
    };

    return {
      a({ node: _node, href, ...props }) {
        const targetPath = resolveMarkdownFileLinkTarget(href, cwd);
        if (!targetPath) {
          return (
            <a {...props} href={href} target="_blank" rel="noopener noreferrer">
              {renderHighlightedChildren(props.children, "markdown-link")}
            </a>
          );
        }

        return (
          <a
            {...props}
            href={href}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              const api = readNativeApi();
              if (api) {
                void openInPreferredEditor(api, targetPath);
              } else {
                console.warn("Native API not found. Unable to open file in editor.");
              }
            }}
          >
            {renderHighlightedChildren(props.children, "markdown-link")}
          </a>
        );
      },
      p({ node: _node, children, ...props }) {
        const paragraphIndex = paragraphRenderIndex;
        paragraphRenderIndex += 1;
        const normalizedParagraph = nodeToPlainText(children).trim();
        const isPendingParagraph =
          pendingPlayParagraphIndex === paragraphIndex ||
          pendingPlayParagraph === normalizedParagraph ||
          optimisticPendingParagraph === normalizedParagraph;
        const isActiveParagraph =
          activeParagraphIndex === paragraphIndex ||
          paragraphMatchesActiveParagraph(normalizedParagraph) ||
          paragraphContainsActiveSentence(children);
        const pendingSentence = isPendingParagraph
          ? extractLeadingSentence(normalizedParagraph)
          : null;
        return (
          <div
            className="group/voice-paragraph flex items-start gap-2"
            data-voice-paragraph-index={paragraphIndex}
            data-voice-paragraph-active={isActiveParagraph ? "true" : undefined}
          >
            <div className="w-6 shrink-0 pt-1 sm:w-5">
              {renderParagraphPlayButton(paragraphIndex, normalizedParagraph)}
            </div>
            <p
              {...props}
              className={`min-w-0 flex-1 rounded-lg px-2 py-1 transition-colors ${
                isPendingParagraph
                  ? "animate-pulse border border-primary/25 bg-primary/8 ring-1 ring-primary/18"
                  : isActiveParagraph
                    ? "bg-primary/8 ring-1 ring-primary/12"
                    : ""
              }`}
            >
              {renderHighlightedChildren(children, "markdown-paragraph", pendingSentence)}
            </p>
          </div>
        );
      },
      li({ node: _node, children, ...props }) {
        const paragraphIndex = paragraphRenderIndex;
        paragraphRenderIndex += 1;
        const normalizedParagraph = nodeToPlainText(children).trim();
        const isPendingParagraph =
          pendingPlayParagraphIndex === paragraphIndex ||
          pendingPlayParagraph === normalizedParagraph ||
          optimisticPendingParagraph === normalizedParagraph;
        const isActiveParagraph =
          activeParagraphIndex === paragraphIndex ||
          paragraphMatchesActiveParagraph(normalizedParagraph) ||
          paragraphContainsActiveSentence(children);
        const pendingSentence = isPendingParagraph
          ? extractLeadingSentence(normalizedParagraph)
          : null;
        return (
          <li {...props}>
            <div
              className="group/voice-paragraph flex items-start gap-2"
              data-voice-paragraph-index={paragraphIndex}
              data-voice-paragraph-active={isActiveParagraph ? "true" : undefined}
            >
              <div className="w-6 shrink-0 pt-1 sm:w-5">
                {renderParagraphPlayButton(paragraphIndex, normalizedParagraph)}
              </div>
              <div
                className={`min-w-0 flex-1 rounded-lg px-2 py-1 transition-colors ${
                  isPendingParagraph
                    ? "animate-pulse border border-primary/25 bg-primary/8 ring-1 ring-primary/18"
                    : isActiveParagraph
                      ? "bg-primary/8 ring-1 ring-primary/12"
                      : ""
                }`}
              >
                {renderHighlightedChildren(children, "markdown-list-item", pendingSentence)}
              </div>
            </div>
          </li>
        );
      },
      blockquote({ node: _node, children, ...props }) {
        return (
          <blockquote {...props}>
            {renderHighlightedChildren(children, "markdown-blockquote")}
          </blockquote>
        );
      },
      h1({ node: _node, children, ...props }) {
        return <h1 {...props}>{renderHighlightedChildren(children, "markdown-heading-1")}</h1>;
      },
      h2({ node: _node, children, ...props }) {
        return <h2 {...props}>{renderHighlightedChildren(children, "markdown-heading-2")}</h2>;
      },
      h3({ node: _node, children, ...props }) {
        return <h3 {...props}>{renderHighlightedChildren(children, "markdown-heading-3")}</h3>;
      },
      h4({ node: _node, children, ...props }) {
        return <h4 {...props}>{renderHighlightedChildren(children, "markdown-heading-4")}</h4>;
      },
      h5({ node: _node, children, ...props }) {
        return <h5 {...props}>{renderHighlightedChildren(children, "markdown-heading-5")}</h5>;
      },
      h6({ node: _node, children, ...props }) {
        return <h6 {...props}>{renderHighlightedChildren(children, "markdown-heading-6")}</h6>;
      },
      pre({ node: _node, children, ...props }) {
        const codeBlock = extractCodeBlock(children);
        if (!codeBlock) {
          return <pre {...props}>{children}</pre>;
        }

        const fenceLanguage = extractFenceLanguage(codeBlock.className);
        if (isMermaidLanguage(fenceLanguage)) {
          return (
            <MermaidBlock
              code={codeBlock.code}
              isStreaming={isStreaming}
              resolvedTheme={resolvedTheme}
            />
          );
        }

        return (
          <MarkdownCodeBlock code={codeBlock.code}>
            <CodeHighlightErrorBoundary fallback={<pre {...props}>{children}</pre>}>
              <Suspense fallback={<pre {...props}>{children}</pre>}>
                <SuspenseShikiCodeBlock
                  className={codeBlock.className}
                  code={codeBlock.code}
                  themeName={diffThemeName}
                  isStreaming={isStreaming}
                />
              </Suspense>
            </CodeHighlightErrorBoundary>
          </MarkdownCodeBlock>
        );
      },
    };
  }, [
    activeSentence,
    activeParagraph,
    activeParagraphIndex,
    isSpeakingPaused,
    cwd,
    diffThemeName,
    isStreaming,
    onPlayParagraph,
    optimisticPendingParagraph,
    pendingPlayParagraph,
    pendingPlayParagraphIndex,
    resolvedTheme,
  ]);

  return (
    <div className="chat-markdown w-full min-w-0 text-sm leading-relaxed text-foreground/80">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

export default memo(ChatMarkdown);
