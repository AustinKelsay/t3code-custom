import type { ThreadId } from "@t3tools/contracts";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { resolveVoicePlaybackRateValue, useAppSettings } from "~/appSettings";
import {
  extractAssistantNarrationParagraphs,
  extractAssistantNarrationSentences,
  extractAssistantNarrationChunks,
  resolveNarrationParagraphForSentence,
  resolveLatestNarratableAssistantMessage,
} from "../ChatView.logic";
import { useStore } from "../../store";
import { useRealtimeSpeechOutput } from "../../voice/useRealtimeSpeechOutput";

interface ListeningCallbacks {
  readonly pauseListening: () => void;
  readonly resumeListening: () => void;
}

interface NarrationUnit {
  readonly paragraphIndex: number;
  readonly sentenceIndex: number;
  readonly paragraph: string;
  readonly sentence: string;
}

type ReadbackOwner = "auto" | "manual" | null;

const EMPTY_MESSAGES: NonNullable<
  ReturnType<typeof useStore.getState>["threads"][number]["messages"]
> = [];

interface ThreadVoiceReadbackContextValue {
  readonly readbackOwner: ReadbackOwner;
  readonly activeSpokenMessageId: string | null;
  readonly activeSpokenSentence: string | null;
  readonly activeSpokenParagraph: string | null;
  readonly activeSpokenParagraphIndex: number | null;
  readonly pendingPlayMessageId: string | null;
  readonly pendingPlayParagraph: string | null;
  readonly pendingPlayParagraphIndex: number | null;
  readonly playFromParagraph: (
    messageId: string,
    fullText: string,
    paragraphIndex: number,
    paragraphText: string,
  ) => Promise<void>;
  readonly blockSpeaking: () => boolean;
  readonly unblockSpeaking: () => void;
  readonly pauseSpeaking: () => boolean;
  readonly resumeSpeaking: () => void;
  readonly stopSpeaking: () => void;
  readonly skipCurrentSentence: () => void;
  readonly registerListeningCallbacks: (callbacks: ListeningCallbacks | null) => void;
}

const NOOP = () => {};

const ThreadVoiceReadbackContext = createContext<ThreadVoiceReadbackContextValue>({
  readbackOwner: null,
  activeSpokenMessageId: null,
  activeSpokenSentence: null,
  activeSpokenParagraph: null,
  activeSpokenParagraphIndex: null,
  pendingPlayMessageId: null,
  pendingPlayParagraph: null,
  pendingPlayParagraphIndex: null,
  playFromParagraph: async () => {},
  blockSpeaking: () => false,
  unblockSpeaking: NOOP,
  pauseSpeaking: () => false,
  resumeSpeaking: NOOP,
  stopSpeaking: NOOP,
  skipCurrentSentence: NOOP,
  registerListeningCallbacks: NOOP,
});

function buildNarrationUnits(text: string): NarrationUnit[] {
  return extractAssistantNarrationParagraphs(text).flatMap((paragraph, paragraphIndex) =>
    extractAssistantNarrationSentences(paragraph).map((sentence, sentenceIndex) => ({
      paragraphIndex,
      sentenceIndex,
      paragraph,
      sentence,
    })),
  );
}

export function useThreadVoiceReadback() {
  return useContext(ThreadVoiceReadbackContext);
}

export function ThreadVoiceReadbackProvider(props: {
  readonly threadId: ThreadId;
  readonly children: React.ReactNode;
}) {
  const { threadId, children } = props;
  const { settings } = useAppSettings();
  const thread = useStore(
    (store) => store.threads.find((candidate) => candidate.id === threadId) ?? null,
  );
  const latestTurnAssistantMessageId = thread?.latestTurn?.assistantMessageId ?? null;
  const serverMessages = thread?.messages ?? EMPTY_MESSAGES;
  const narratedAssistantMessageRef = useRef<{
    messageId: string | null;
    spokenChunkCount: number;
  }>({
    messageId: null,
    spokenChunkCount: 0,
  });
  const suppressedAutoMessageIdRef = useRef<string | null>(null);
  const listeningCallbacksRef = useRef<ListeningCallbacks | null>(null);
  const activeNarrationMessageIdRef = useRef<string | null>(null);
  const activeNarrationTextRef = useRef<string>("");
  const narrationUnitsRef = useRef<readonly NarrationUnit[]>([]);
  const narrationCursorRef = useRef(0);
  const readbackOwnerRef = useRef<ReadbackOwner>(null);
  const activeSpokenMessageIdRef = useRef<string | null>(null);
  const activeSpokenSentenceRef = useRef<string | null>(null);
  const [readbackOwner, setReadbackOwner] = useState<ReadbackOwner>(null);
  const [activeSpokenMessageId, setActiveSpokenMessageId] = useState<string | null>(null);
  const [activeSpokenSentence, setActiveSpokenSentence] = useState<string | null>(null);
  const [activeSpokenParagraph, setActiveSpokenParagraph] = useState<string | null>(null);
  const [activeSpokenParagraphIndex, setActiveSpokenParagraphIndex] = useState<number | null>(null);
  const [pendingPlayMessageId, setPendingPlayMessageId] = useState<string | null>(null);
  const [pendingPlayParagraph, setPendingPlayParagraph] = useState<string | null>(null);
  const [pendingPlayParagraphIndex, setPendingPlayParagraphIndex] = useState<number | null>(null);

  useEffect(() => {
    readbackOwnerRef.current = readbackOwner;
  }, [readbackOwner]);

  useEffect(() => {
    activeSpokenMessageIdRef.current = activeSpokenMessageId;
  }, [activeSpokenMessageId]);

  useEffect(() => {
    activeSpokenSentenceRef.current = activeSpokenSentence;
  }, [activeSpokenSentence]);

  const registerListeningCallbacks = useCallback((callbacks: ListeningCallbacks | null) => {
    listeningCallbacksRef.current = callbacks;
  }, []);

  const {
    blockSpeaking,
    unblockSpeaking,
    pauseSpeaking,
    resumeSpeaking,
    stopSpeaking,
    skipCurrentSentence,
    replaceSpeechQueue,
    speakText: speakAssistantText,
  } = useRealtimeSpeechOutput({
    threadId,
    enabled: settings.voiceEnabled && settings.voiceAutoSpeakReplies,
    model: settings.voiceModel.trim() || null,
    voice: settings.voiceName.trim() || null,
    instructions: settings.voiceInstructions.trim() || null,
    playbackRate: resolveVoicePlaybackRateValue(settings.voicePlaybackRate),
    onUtteranceStart: () => listeningCallbacksRef.current?.pauseListening(),
    onUtteranceEnd: () => listeningCallbacksRef.current?.resumeListening(),
    onPlaybackProgress: ({ text }) => {
      setPendingPlayMessageId(null);
      setPendingPlayParagraph(null);
      setPendingPlayParagraphIndex(null);
      const messageId = activeNarrationMessageIdRef.current;
      const sentence = text.trim() || null;
      setActiveSpokenMessageId(messageId);
      setActiveSpokenSentence(sentence);
      const sourceMessage = serverMessages.find((message) => message.id === messageId) ?? null;
      const sourceText = sourceMessage?.text ?? activeNarrationTextRef.current;
      if (sourceText !== activeNarrationTextRef.current) {
        activeNarrationTextRef.current = sourceText;
        narrationUnitsRef.current = buildNarrationUnits(sourceText);
      }
      const units = narrationUnitsRef.current;
      const normalizedSentence = sentence?.trim() ?? "";
      let matchedUnit: NarrationUnit | null = null;
      if (normalizedSentence && units.length > 0) {
        const searchStart = Math.max(0, narrationCursorRef.current - 1);
        const nextMatchIndex = units.findIndex(
          (unit, index) => index >= searchStart && unit.sentence === normalizedSentence,
        );
        if (nextMatchIndex >= 0) {
          matchedUnit = units[nextMatchIndex] ?? null;
          narrationCursorRef.current = nextMatchIndex + 1;
        }
      }
      setActiveSpokenParagraphIndex(matchedUnit?.paragraphIndex ?? null);
      setActiveSpokenParagraph(
        matchedUnit?.paragraph ??
          (sourceText ? resolveNarrationParagraphForSentence(sourceText, sentence) : null),
      );
    },
    onPlaybackIdle: () => {
      setReadbackOwner(null);
      setPendingPlayMessageId(null);
      setPendingPlayParagraph(null);
      setPendingPlayParagraphIndex(null);
      setActiveSpokenMessageId(null);
      setActiveSpokenSentence(null);
      setActiveSpokenParagraph(null);
      setActiveSpokenParagraphIndex(null);
      activeNarrationTextRef.current = "";
      narrationUnitsRef.current = [];
      narrationCursorRef.current = 0;
    },
  });

  const latestNarratableAssistantMessage = useMemo(() => {
    return resolveLatestNarratableAssistantMessage({
      messages: serverMessages,
      preferredAssistantMessageId: latestTurnAssistantMessageId,
      preferTurnCompletion: Boolean(latestTurnAssistantMessageId),
    });
  }, [latestTurnAssistantMessageId, serverMessages]);
  const latestNarratableAssistantMessageId = latestNarratableAssistantMessage?.id ?? null;
  const latestNarratableAssistantText = latestNarratableAssistantMessage?.text ?? "";
  const latestNarratableAssistantStreaming = latestNarratableAssistantMessage?.streaming ?? false;

  useEffect(() => {
    if (!settings.voiceAutoSpeakReplies || !settings.voiceEnabled) {
      setReadbackOwner(null);
      return;
    }
  }, [settings.voiceAutoSpeakReplies, settings.voiceEnabled]);

  useEffect(() => {
    const assistantMessage = latestNarratableAssistantMessage;
    if (!assistantMessage || !settings.voiceAutoSpeakReplies) {
      return;
    }
    if (
      suppressedAutoMessageIdRef.current &&
      suppressedAutoMessageIdRef.current !== assistantMessage.id
    ) {
      suppressedAutoMessageIdRef.current = null;
    }
    if (suppressedAutoMessageIdRef.current === assistantMessage.id) {
      narratedAssistantMessageRef.current = {
        messageId: assistantMessage.id,
        spokenChunkCount: extractAssistantNarrationSentences(assistantMessage.text).length,
      };
      return;
    }
    if (readbackOwnerRef.current === "manual") {
      suppressedAutoMessageIdRef.current = assistantMessage.id;
      narratedAssistantMessageRef.current = {
        messageId: assistantMessage.id,
        spokenChunkCount: extractAssistantNarrationSentences(assistantMessage.text).length,
      };
      return;
    }

    if (narratedAssistantMessageRef.current.messageId !== assistantMessage.id) {
      narratedAssistantMessageRef.current = {
        messageId: assistantMessage.id,
        spokenChunkCount: 0,
      };
    }

    const { chunks, nextSpokenChunkCount } = extractAssistantNarrationChunks({
      text: assistantMessage.text,
      spokenChunkCount: narratedAssistantMessageRef.current.spokenChunkCount,
      isComplete: !assistantMessage.streaming,
    });
    if (chunks.length === 0) {
      return;
    }

    narratedAssistantMessageRef.current = {
      messageId: assistantMessage.id,
      spokenChunkCount: nextSpokenChunkCount,
    };
    setReadbackOwner("auto");
    activeNarrationMessageIdRef.current = assistantMessage.id;
    activeNarrationTextRef.current = assistantMessage.text;
    narrationUnitsRef.current = buildNarrationUnits(assistantMessage.text);
    narrationCursorRef.current = Math.min(
      narrationCursorRef.current,
      narrationUnitsRef.current.length,
    );
    if (
      chunks.length > 0 &&
      !activeSpokenSentenceRef.current &&
      activeSpokenMessageIdRef.current !== assistantMessage.id
    ) {
      const firstUnit =
        narrationUnitsRef.current.find((unit) => unit.sentence === (chunks[0] ?? null)) ?? null;
      setActiveSpokenMessageId(assistantMessage.id);
      setActiveSpokenSentence(chunks[0] ?? null);
      setActiveSpokenParagraph(firstUnit?.paragraph ?? null);
      setActiveSpokenParagraphIndex(firstUnit?.paragraphIndex ?? null);
    }
    for (const chunk of chunks) {
      activeNarrationMessageIdRef.current = assistantMessage.id;
      speakAssistantText(chunk);
    }
  }, [
    latestNarratableAssistantMessage,
    latestNarratableAssistantMessageId,
    latestNarratableAssistantStreaming,
    latestNarratableAssistantText,
    settings.voiceAutoSpeakReplies,
    readbackOwner,
    speakAssistantText,
  ]);

  const playFromParagraph = useCallback(
    async (messageId: string, fullText: string, paragraphIndex: number, paragraphText: string) => {
      const paragraphs = extractAssistantNarrationParagraphs(fullText);
      const normalizedParagraph = paragraphText.trim();
      if (normalizedParagraph.length === 0 || paragraphs.length === 0) {
        return;
      }
      const startIndex = Math.max(0, Math.min(paragraphs.length - 1, paragraphIndex));
      const remainingParagraphs = paragraphs.slice(startIndex);
      const sentences = remainingParagraphs.flatMap((paragraph) =>
        extractAssistantNarrationSentences(paragraph),
      );
      if (sentences.length === 0) {
        return;
      }
      suppressedAutoMessageIdRef.current = latestNarratableAssistantMessageId;
      setReadbackOwner("manual");
      activeNarrationMessageIdRef.current = messageId;
      activeNarrationTextRef.current = fullText;
      narrationUnitsRef.current = buildNarrationUnits(fullText).filter(
        (unit) => unit.paragraphIndex >= startIndex,
      );
      narrationCursorRef.current = 0;
      setPendingPlayMessageId(messageId);
      setPendingPlayParagraph(normalizedParagraph);
      setPendingPlayParagraphIndex(startIndex);
      setActiveSpokenMessageId(messageId);
      setActiveSpokenSentence(null);
      setActiveSpokenParagraph(normalizedParagraph);
      setActiveSpokenParagraphIndex(startIndex);
      await replaceSpeechQueue(sentences);
    },
    [latestNarratableAssistantMessageId, replaceSpeechQueue],
  );

  const stopSpeakingWithOwnershipReset = useCallback(() => {
    setReadbackOwner(null);
    stopSpeaking();
  }, [stopSpeaking]);

  const skipCurrentSentenceKeepingOwnership = useCallback(() => {
    skipCurrentSentence();
  }, [skipCurrentSentence]);

  const value = useMemo<ThreadVoiceReadbackContextValue>(
    () => ({
      readbackOwner,
      activeSpokenMessageId,
      activeSpokenSentence,
      activeSpokenParagraph,
      activeSpokenParagraphIndex,
      pendingPlayMessageId,
      pendingPlayParagraph,
      pendingPlayParagraphIndex,
      playFromParagraph,
      pauseSpeaking,
      blockSpeaking,
      unblockSpeaking,
      resumeSpeaking,
      stopSpeaking: stopSpeakingWithOwnershipReset,
      skipCurrentSentence: skipCurrentSentenceKeepingOwnership,
      registerListeningCallbacks,
    }),
    [
      readbackOwner,
      activeSpokenMessageId,
      activeSpokenSentence,
      activeSpokenParagraph,
      activeSpokenParagraphIndex,
      blockSpeaking,
      pendingPlayMessageId,
      pendingPlayParagraph,
      pendingPlayParagraphIndex,
      playFromParagraph,
      pauseSpeaking,
      registerListeningCallbacks,
      resumeSpeaking,
      skipCurrentSentenceKeepingOwnership,
      stopSpeakingWithOwnershipReset,
      unblockSpeaking,
    ],
  );

  return (
    <ThreadVoiceReadbackContext.Provider value={value}>
      {children}
    </ThreadVoiceReadbackContext.Provider>
  );
}
