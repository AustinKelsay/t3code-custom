import {
  type ThreadNotesDocument,
  ThreadNotesGetInput,
  ThreadNotesUpsertInput,
} from "@t3tools/contracts";
import { Option, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export interface ThreadNotesRepositoryShape {
  readonly getByThreadId: (
    input: typeof ThreadNotesGetInput.Type,
  ) => Effect.Effect<Option.Option<ThreadNotesDocument>, ProjectionRepositoryError>;
  readonly upsert: (
    input: typeof ThreadNotesUpsertInput.Type,
  ) => Effect.Effect<ThreadNotesDocument, ProjectionRepositoryError>;
}

export class ThreadNotesRepository extends ServiceMap.Service<
  ThreadNotesRepository,
  ThreadNotesRepositoryShape
>()("t3/persistence/Services/ThreadNotes/ThreadNotesRepository") {}
