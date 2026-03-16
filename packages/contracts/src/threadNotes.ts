import { Schema } from "effect";

import { IsoDateTime, ThreadId } from "./baseSchemas";

export const ThreadNotesDocument = Schema.Struct({
  threadId: ThreadId,
  notes: Schema.String,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ThreadNotesDocument = typeof ThreadNotesDocument.Type;

export const ThreadNotesGetInput = Schema.Struct({
  threadId: ThreadId,
});
export type ThreadNotesGetInput = typeof ThreadNotesGetInput.Type;

export const ThreadNotesUpsertInput = Schema.Struct({
  threadId: ThreadId,
  notes: Schema.String,
});
export type ThreadNotesUpsertInput = typeof ThreadNotesUpsertInput.Type;
