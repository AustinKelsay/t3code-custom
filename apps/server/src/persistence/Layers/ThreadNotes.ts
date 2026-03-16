import {
  type ThreadNotesDocument as ThreadNotesDocumentRecord,
  ThreadNotesDocument,
  ThreadNotesGetInput,
} from "@t3tools/contracts";
import { Effect, Layer, Option } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import { ThreadNotesRepository, type ThreadNotesRepositoryShape } from "../Services/ThreadNotes.ts";

const makeThreadNotesRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertThreadNotesRow = SqlSchema.void({
    Request: ThreadNotesDocument,
    execute: (row) =>
      sql`
        INSERT INTO thread_notes (
          thread_id,
          notes,
          created_at,
          updated_at
        )
        VALUES (
          ${row.threadId},
          ${row.notes},
          ${row.createdAt},
          ${row.updatedAt}
        )
        ON CONFLICT (thread_id)
        DO UPDATE SET
          notes = excluded.notes,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
      `,
  });

  const getThreadNotesRow = SqlSchema.findOneOption({
    Request: ThreadNotesGetInput,
    Result: ThreadNotesDocument,
    execute: ({ threadId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          notes,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM thread_notes
        WHERE thread_id = ${threadId}
      `,
  });

  const getByThreadId: ThreadNotesRepositoryShape["getByThreadId"] = (input) =>
    getThreadNotesRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ThreadNotesRepository.getByThreadId:query")),
    );

  const upsert: ThreadNotesRepositoryShape["upsert"] = (input) =>
    Effect.gen(function* () {
      const existing = yield* getByThreadId({ threadId: input.threadId });
      const timestamp = new Date().toISOString();
      const row: ThreadNotesDocumentRecord = {
        threadId: input.threadId,
        notes: input.notes,
        createdAt: Option.match(existing, {
          onNone: () => timestamp,
          onSome: (document) => document.createdAt,
        }),
        updatedAt: timestamp,
      };
      yield* upsertThreadNotesRow(row).pipe(
        Effect.mapError(toPersistenceSqlError("ThreadNotesRepository.upsert:query")),
      );
      return row;
    });

  return {
    getByThreadId,
    upsert,
  } satisfies ThreadNotesRepositoryShape;
});

export const ThreadNotesRepositoryLive = Layer.effect(
  ThreadNotesRepository,
  makeThreadNotesRepository,
);
