import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE projection_turns
    ADD COLUMN queue_item_id TEXT
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_queued_turns (
      queue_item_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      request_json TEXT NOT NULL,
      status TEXT NOT NULL,
      failure_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_queued_turns_thread_status_created
    ON projection_queued_turns(thread_id, status, created_at)
  `;
});
