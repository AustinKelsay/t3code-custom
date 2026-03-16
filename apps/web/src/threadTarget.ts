import { LOCAL_EXECUTION_TARGET_ID, type ExecutionTargetId } from "@t3tools/contracts";

export function resolveThreadTargetId(input: {
  readonly thread?:
    | {
        readonly targetId?: ExecutionTargetId | null;
        readonly session?: {
          readonly targetId?: ExecutionTargetId | null;
        } | null;
      }
    | null
    | undefined;
  readonly projectTargetId?: ExecutionTargetId | null;
}): ExecutionTargetId {
  return (
    input.thread?.session?.targetId ??
    input.thread?.targetId ??
    input.projectTargetId ??
    LOCAL_EXECUTION_TARGET_ID
  );
}
