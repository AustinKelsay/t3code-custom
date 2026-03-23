export function shouldShowNoCompletedTurnsState(input: {
  isUncommittedSelection: boolean;
  orderedTurnCount: number;
}): boolean {
  return input.orderedTurnCount === 0 && !input.isUncommittedSelection;
}
