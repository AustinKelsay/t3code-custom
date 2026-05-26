import {
  IsoDateTime,
  OrchestrationQueuedTurnStatus,
  ThreadId,
  ThreadQueuedTurnRequest,
  TurnQueueItemId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionQueuedTurn = Schema.Struct({
  queueItemId: TurnQueueItemId,
  threadId: ThreadId,
  request: ThreadQueuedTurnRequest,
  status: OrchestrationQueuedTurnStatus,
  failureReason: Schema.NullOr(Schema.String),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ProjectionQueuedTurn = typeof ProjectionQueuedTurn.Type;

export const ListProjectionQueuedTurnsInput = Schema.Struct({
  threadId: Schema.optional(ThreadId),
});
export type ListProjectionQueuedTurnsInput = typeof ListProjectionQueuedTurnsInput.Type;

export const DeleteProjectionQueuedTurnsInput = Schema.Struct({
  threadId: ThreadId,
});
export type DeleteProjectionQueuedTurnsInput = typeof DeleteProjectionQueuedTurnsInput.Type;

export const DeleteProjectionQueuedTurnByQueueItemIdInput = Schema.Struct({
  queueItemId: TurnQueueItemId,
});
export type DeleteProjectionQueuedTurnByQueueItemIdInput =
  typeof DeleteProjectionQueuedTurnByQueueItemIdInput.Type;

export interface ProjectionQueuedTurnRepositoryShape {
  readonly upsert: (row: ProjectionQueuedTurn) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getByQueueItemId: (input: {
    readonly queueItemId: TurnQueueItemId;
  }) => Effect.Effect<Option.Option<ProjectionQueuedTurn>, ProjectionRepositoryError>;
  readonly list: (
    input?: ListProjectionQueuedTurnsInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionQueuedTurn>, ProjectionRepositoryError>;
  readonly deleteByThreadId: (
    input: DeleteProjectionQueuedTurnsInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly deleteByQueueItemId: (
    input: DeleteProjectionQueuedTurnByQueueItemIdInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectionQueuedTurnRepository extends Context.Service<
  ProjectionQueuedTurnRepository,
  ProjectionQueuedTurnRepositoryShape
>()("t3/persistence/Services/ProjectionQueuedTurns/ProjectionQueuedTurnRepository") {}
