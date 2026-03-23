import { LOCAL_EXECUTION_TARGET_ID, type ExecutionTargetId } from "@t3tools/contracts";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

import type { CheckpointStoreError } from "../Errors.ts";
import type { CheckpointStoreShape } from "./CheckpointStore.ts";

export interface CheckpointStoreResolverShape {
  readonly resolveForTarget: (
    targetId: ExecutionTargetId | null | undefined,
  ) => Effect.Effect<CheckpointStoreShape, CheckpointStoreError>;
}

export const normalizeCheckpointTargetId = (
  targetId: ExecutionTargetId | null | undefined,
): ExecutionTargetId => targetId ?? LOCAL_EXECUTION_TARGET_ID;

export class CheckpointStoreResolver extends ServiceMap.Service<
  CheckpointStoreResolver,
  CheckpointStoreResolverShape
>()("t3/checkpointing/Services/CheckpointStoreResolver") {}
