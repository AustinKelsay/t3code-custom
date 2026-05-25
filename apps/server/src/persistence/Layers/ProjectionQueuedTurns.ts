import { ThreadId, ThreadQueuedTurnRequest, TurnQueueItemId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  DeleteProjectionQueuedTurnByQueueItemIdInput,
  DeleteProjectionQueuedTurnsInput,
  ListProjectionQueuedTurnsInput,
  ProjectionQueuedTurn,
  ProjectionQueuedTurnRepository,
  type ProjectionQueuedTurnRepositoryShape,
} from "../Services/ProjectionQueuedTurns.ts";

const ProjectionQueuedTurnRow = Schema.Struct({
  queueItemId: TurnQueueItemId,
  threadId: ThreadId,
  request: Schema.fromJsonString(ThreadQueuedTurnRequest),
  status: ProjectionQueuedTurn.fields.status,
  failureReason: ProjectionQueuedTurn.fields.failureReason,
  createdAt: ProjectionQueuedTurn.fields.createdAt,
  updatedAt: ProjectionQueuedTurn.fields.updatedAt,
});

const encodeRequestJson = Schema.encodeUnknownSync(Schema.fromJsonString(ThreadQueuedTurnRequest));

const GetProjectionQueuedTurnInput = Schema.Struct({
  queueItemId: TurnQueueItemId,
});

function mapProjectionQueuedTurnRow(
  row: Schema.Schema.Type<typeof ProjectionQueuedTurnRow>,
): ProjectionQueuedTurn {
  return {
    queueItemId: row.queueItemId,
    threadId: row.threadId,
    request: row.request,
    status: row.status,
    failureReason: row.failureReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const makeProjectionQueuedTurnRepository = Effect.fn("makeProjectionQueuedTurnRepository")(
  function* () {
    const sql = yield* SqlClient.SqlClient;

    const upsertProjectionQueuedTurnRow = SqlSchema.void({
      Request: ProjectionQueuedTurn,
      execute: (row) =>
        sql`
        INSERT INTO projection_queued_turns (
          queue_item_id,
          thread_id,
          request_json,
          status,
          failure_reason,
          created_at,
          updated_at
        )
        VALUES (
          ${row.queueItemId},
          ${row.threadId},
          ${encodeRequestJson(row.request)},
          ${row.status},
          ${row.failureReason},
          ${row.createdAt},
          ${row.updatedAt}
        )
        ON CONFLICT (queue_item_id)
        DO UPDATE SET
          thread_id = excluded.thread_id,
          request_json = excluded.request_json,
          status = excluded.status,
          failure_reason = excluded.failure_reason,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
      `,
    });

    const getProjectionQueuedTurnRow = SqlSchema.findOneOption({
      Request: GetProjectionQueuedTurnInput,
      Result: ProjectionQueuedTurnRow,
      execute: ({ queueItemId }) =>
        sql`
        SELECT
          queue.queue_item_id AS "queueItemId",
          queue.thread_id AS "threadId",
          queue.request_json AS "request",
          queue.status AS status,
          queue.failure_reason AS "failureReason",
          queue.created_at AS "createdAt",
          queue.updated_at AS "updatedAt"
        FROM projection_queued_turns AS queue
        WHERE queue.queue_item_id = ${queueItemId}
      `,
    });

    const listProjectionQueuedTurnRows = SqlSchema.findAll({
      Request: ListProjectionQueuedTurnsInput,
      Result: ProjectionQueuedTurnRow,
      execute: (input) =>
        input.threadId === undefined
          ? sql`
            SELECT
              queue.queue_item_id AS "queueItemId",
              queue.thread_id AS "threadId",
              queue.request_json AS "request",
              queue.status AS status,
              queue.failure_reason AS "failureReason",
              queue.created_at AS "createdAt",
              queue.updated_at AS "updatedAt"
            FROM projection_queued_turns AS queue
            ORDER BY queue.created_at ASC, queue.queue_item_id ASC
          `
          : sql`
            SELECT
              queue.queue_item_id AS "queueItemId",
              queue.thread_id AS "threadId",
              queue.request_json AS "request",
              queue.status AS status,
              queue.failure_reason AS "failureReason",
              queue.created_at AS "createdAt",
              queue.updated_at AS "updatedAt"
            FROM projection_queued_turns AS queue
            WHERE queue.thread_id = ${input.threadId}
            ORDER BY queue.created_at ASC, queue.queue_item_id ASC
          `,
    });

    const deleteProjectionQueuedTurnRows = SqlSchema.void({
      Request: DeleteProjectionQueuedTurnsInput,
      execute: ({ threadId }) =>
        sql`
        DELETE FROM projection_queued_turns
        WHERE thread_id = ${threadId}
      `,
    });

    const deleteProjectionQueuedTurnRowByQueueItemId = SqlSchema.void({
      Request: DeleteProjectionQueuedTurnByQueueItemIdInput,
      execute: ({ queueItemId }) =>
        sql`
        DELETE FROM projection_queued_turns
        WHERE queue_item_id = ${queueItemId}
      `,
    });

    const upsert: ProjectionQueuedTurnRepositoryShape["upsert"] = (row) =>
      upsertProjectionQueuedTurnRow(row).pipe(
        Effect.mapError(toPersistenceSqlError("ProjectionQueuedTurnRepository.upsert:query")),
      );

    const getByQueueItemId: ProjectionQueuedTurnRepositoryShape["getByQueueItemId"] = (input) =>
      getProjectionQueuedTurnRow(input).pipe(
        Effect.map(
          Option.map((row: Schema.Schema.Type<typeof ProjectionQueuedTurnRow>) =>
            mapProjectionQueuedTurnRow(row),
          ),
        ),
        Effect.mapError(
          toPersistenceSqlError("ProjectionQueuedTurnRepository.getByQueueItemId:query"),
        ),
      );

    const list: ProjectionQueuedTurnRepositoryShape["list"] = (input = {}) =>
      listProjectionQueuedTurnRows(input).pipe(
        Effect.map((rows) => rows.map(mapProjectionQueuedTurnRow)),
        Effect.mapError(toPersistenceSqlError("ProjectionQueuedTurnRepository.list:query")),
      );

    const deleteByThreadId: ProjectionQueuedTurnRepositoryShape["deleteByThreadId"] = (input) =>
      deleteProjectionQueuedTurnRows(input).pipe(
        Effect.mapError(
          toPersistenceSqlError("ProjectionQueuedTurnRepository.deleteByThreadId:query"),
        ),
      );

    const deleteByQueueItemId: ProjectionQueuedTurnRepositoryShape["deleteByQueueItemId"] = (
      input,
    ) =>
      deleteProjectionQueuedTurnRowByQueueItemId(input).pipe(
        Effect.mapError(
          toPersistenceSqlError("ProjectionQueuedTurnRepository.deleteByQueueItemId:query"),
        ),
      );

    return {
      upsert,
      getByQueueItemId,
      list,
      deleteByThreadId,
      deleteByQueueItemId,
    } satisfies ProjectionQueuedTurnRepositoryShape;
  },
);

export const ProjectionQueuedTurnRepositoryLive = Layer.effect(
  ProjectionQueuedTurnRepository,
  makeProjectionQueuedTurnRepository(),
);
