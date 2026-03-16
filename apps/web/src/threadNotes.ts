export function appendThreadNoteSelectionToPrompt(prompt: string, selectionText: string): string {
  const trimmedSelection = selectionText.trim();
  if (trimmedSelection.length === 0) {
    return prompt;
  }
  const trimmedPrompt = prompt.trim();
  return trimmedPrompt.length > 0 ? `${trimmedPrompt}\n\n${trimmedSelection}` : trimmedSelection;
}
