import type { ThreadId } from "@t3tools/contracts";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";

import { useAppSettings } from "~/appSettings";
import {
  extractAssistantNarrationChunks,
  resolveLatestNarratableAssistantMessage,
} from "../ChatView.logic";
import { useStore } from "../../store";
import { useRealtimeSpeechOutput } from "../../voice/useRealtimeSpeechOutput";

interface ListeningCallbacks {
  readonly pauseListening: () => void;
  readonly resumeListening: () => void;
}

interface ThreadVoiceReadbackContextValue {
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
  blockSpeaking: () => false,
  unblockSpeaking: NOOP,
  pauseSpeaking: () => false,
  resumeSpeaking: NOOP,
  stopSpeaking: NOOP,
  skipCurrentSentence: NOOP,
  registerListeningCallbacks: NOOP,
});

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
  const serverMessages = thread?.messages ?? [];
  const narratedAssistantMessageRef = useRef<{
    messageId: string | null;
    spokenChunkCount: number;
  }>({
    messageId: null,
    spokenChunkCount: 0,
  });
  const listeningCallbacksRef = useRef<ListeningCallbacks | null>(null);

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
    speakText: speakAssistantText,
  } = useRealtimeSpeechOutput({
    threadId,
    enabled: settings.voiceEnabled && settings.voiceAutoSpeakReplies,
    model: settings.voiceModel.trim() || null,
    voice: settings.voiceName.trim() || null,
    instructions: settings.voiceInstructions.trim() || null,
    playbackRate: Number(settings.voicePlaybackRate),
    onUtteranceStart: () => listeningCallbacksRef.current?.pauseListening(),
    onUtteranceEnd: () => listeningCallbacksRef.current?.resumeListening(),
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
    const assistantMessage = latestNarratableAssistantMessage;
    if (!assistantMessage || !settings.voiceAutoSpeakReplies) {
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
    for (const chunk of chunks) {
      speakAssistantText(chunk);
    }
  }, [
    latestNarratableAssistantMessage,
    latestNarratableAssistantMessageId,
    latestNarratableAssistantStreaming,
    latestNarratableAssistantText,
    settings.voiceAutoSpeakReplies,
    speakAssistantText,
  ]);

  const value = useMemo<ThreadVoiceReadbackContextValue>(
    () => ({
      pauseSpeaking,
      blockSpeaking,
      unblockSpeaking,
      resumeSpeaking,
      stopSpeaking,
      skipCurrentSentence,
      registerListeningCallbacks,
    }),
    [
      blockSpeaking,
      pauseSpeaking,
      registerListeningCallbacks,
      resumeSpeaking,
      skipCurrentSentence,
      stopSpeaking,
      unblockSpeaking,
    ],
  );

  return (
    <ThreadVoiceReadbackContext.Provider value={value}>
      {children}
    </ThreadVoiceReadbackContext.Provider>
  );
}
