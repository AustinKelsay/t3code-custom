import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

type TableColumnRow = {
  readonly name: string;
};

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const columns = yield* sql<TableColumnRow>`
    PRAGMA table_info(projection_threads)
  `;

  const hasPinnedAt = columns.some((column) => column.name === "pinned_at");
  if (!hasPinnedAt) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN pinned_at TEXT
    `;
  }

  const hasSortOrder = columns.some((column) => column.name === "sort_order");
  if (!hasSortOrder) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN sort_order INTEGER
    `;
  }

  yield* sql`
    WITH ranked_threads AS (
      SELECT
        thread_id,
        ROW_NUMBER() OVER (
          PARTITION BY project_id
          ORDER BY created_at DESC, thread_id DESC
        ) AS next_sort_order
      FROM projection_threads
      WHERE sort_order IS NULL
    )
    UPDATE projection_threads
    SET sort_order = (
      SELECT next_sort_order
      FROM ranked_threads
      WHERE ranked_threads.thread_id = projection_threads.thread_id
    )
    WHERE thread_id IN (
      SELECT thread_id
      FROM ranked_threads
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_threads_project_pinned_sort
    ON projection_threads(project_id, pinned_at, sort_order)
  `;
});
