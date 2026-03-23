import { Effect, FileSystem, Layer, Path } from "effect";

import { ExecutionTargetService } from "../../executionTarget/Services/ExecutionTargetService.ts";
import { makeTargetGitService } from "../../git/makeTargetGitService.ts";
import { GitService } from "../../git/Services/GitService.ts";
import { CheckpointInvariantError } from "../Errors.ts";
import { makeCheckpointStoreShape } from "../makeCheckpointStoreShape.ts";
import { CheckpointStore } from "../Services/CheckpointStore.ts";
import {
  CheckpointStoreResolver,
  normalizeCheckpointTargetId,
  type CheckpointStoreResolverShape,
} from "../Services/CheckpointStoreResolver.ts";
import type { CheckpointStoreShape } from "../Services/CheckpointStore.ts";

const make = Effect.gen(function* () {
  const checkpointStore = yield* CheckpointStore;
  const executionTargets = yield* ExecutionTargetService;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const checkpointStoreByTargetId = new Map<string, CheckpointStoreShape>();

  const resolveForTarget: CheckpointStoreResolverShape["resolveForTarget"] = (targetId) =>
    Effect.gen(function* () {
      const normalizedTargetId = normalizeCheckpointTargetId(targetId);
      if (normalizedTargetId === "local") {
        return checkpointStore;
      }

      const cached = checkpointStoreByTargetId.get(normalizedTargetId);
      if (cached) {
        return cached;
      }

      const target = yield* executionTargets.getByIdForRuntime(normalizedTargetId).pipe(
        Effect.mapError(
          (error) =>
            new CheckpointInvariantError({
              operation: "CheckpointStoreResolver.resolveForTarget",
              detail: error.message,
              ...(error.cause !== undefined ? { cause: error.cause } : {}),
            }),
        ),
      );
      const remoteCheckpointStore = yield* makeCheckpointStoreShape({
        cleanupTempIndex: false,
        tempIndexDir: "/tmp",
      }).pipe(
        Effect.provideService(GitService, makeTargetGitService(target)),
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, path),
      );
      checkpointStoreByTargetId.set(normalizedTargetId, remoteCheckpointStore);
      return remoteCheckpointStore;
    });

  return {
    resolveForTarget,
  } satisfies CheckpointStoreResolverShape;
});

export const CheckpointStoreResolverLive = Layer.effect(CheckpointStoreResolver, make);
