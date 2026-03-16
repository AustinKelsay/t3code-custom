import { type ThreadId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { useComposerThreadDraft, useComposerDraftStore } from "../composerDraftStore";
import { useThreadNotesDocument } from "../lib/threadNotesReactQuery";
import { appendThreadNoteSelectionToPrompt } from "../threadNotes";
import { ThreadNotesEditor } from "./notes/ThreadNotesEditor";

interface ThreadNotesPageProps {
  threadId: ThreadId;
}

export function ThreadNotesPage({ threadId }: ThreadNotesPageProps) {
  const navigate = useNavigate();
  const { editorInstanceKey, notes, setNotes, isLoading, isSaving, errorMessage } =
    useThreadNotesDocument(threadId);
  const composerDraft = useComposerThreadDraft(threadId);
  const setComposerPrompt = useComposerDraftStore((store) => store.setPrompt);
  const [selectedText, setSelectedText] = useState("");
  const selectedCharacterCount = selectedText.length;

  const onSendSelectionToChat = useCallback(() => {
    if (selectedText.length === 0) {
      return;
    }
    const nextPrompt = appendThreadNoteSelectionToPrompt(composerDraft.prompt, selectedText);
    setComposerPrompt(threadId, nextPrompt);
    void navigate({
      to: "/$threadId",
      params: { threadId },
    });
  }, [composerDraft.prompt, navigate, selectedText, setComposerPrompt, threadId]);

  return (
    <div className="relative min-h-0 flex-1 bg-muted/28">
      {isLoading ? (
        <div className="flex h-full items-center justify-center px-6 text-center text-muted-foreground text-sm">
          Loading notes...
        </div>
      ) : (
        <ThreadNotesEditor
          key={editorInstanceKey}
          initialState={notes}
          onChange={setNotes}
          onSelectionTextChange={setSelectedText}
          onSendSelectionToChat={onSendSelectionToChat}
          placeholder="Start writing notes for this session. Use headings, quotes, bullets, and checklists, then highlight any passage to send it into chat."
          selectedCharacterCount={selectedCharacterCount}
          threadId={threadId}
        />
      )}
      {errorMessage || isSaving ? (
        <div className="pointer-events-none absolute right-4 bottom-4 z-10 sm:right-6 sm:bottom-6">
          <p className="rounded-full bg-background/88 px-3 py-1 text-center text-muted-foreground text-xs shadow-xs/5 backdrop-blur">
            {errorMessage ?? "Saving notes..."}
          </p>
        </div>
      ) : null}
    </div>
  );
}

export default ThreadNotesPage;
