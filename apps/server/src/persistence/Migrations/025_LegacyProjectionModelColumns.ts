import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

type TableColumnRow = {
  readonly name: string;
};

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const projectColumns = yield* sql<TableColumnRow>`
    PRAGMA table_info(projection_projects)
  `;

  const hasProjectDefaultModel = projectColumns.some((column) => column.name === "default_model");
  if (!hasProjectDefaultModel) {
    yield* sql`
      ALTER TABLE projection_projects
      ADD COLUMN default_model TEXT
    `;
  }

  const hasProjectDefaultModelSelectionJson = projectColumns.some(
    (column) => column.name === "default_model_selection_json",
  );
  if (hasProjectDefaultModelSelectionJson) {
    yield* sql`
      UPDATE projection_projects
      SET default_model = COALESCE(
        NULLIF(TRIM(default_model), ''),
        json_extract(default_model_selection_json, '$.model')
      )
      WHERE default_model IS NULL OR TRIM(default_model) = ''
    `;
  }

  const threadColumns = yield* sql<TableColumnRow>`
    PRAGMA table_info(projection_threads)
  `;

  const hasThreadModel = threadColumns.some((column) => column.name === "model");
  if (!hasThreadModel) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN model TEXT
    `;
  }

  const hasPinnedAt = threadColumns.some((column) => column.name === "pinned_at");
  if (!hasPinnedAt) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN pinned_at TEXT
    `;
  }

  const hasSortOrder = threadColumns.some((column) => column.name === "sort_order");
  if (!hasSortOrder) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN sort_order INTEGER
    `;
  }

  const hasModelSelectionJson = threadColumns.some(
    (column) => column.name === "model_selection_json",
  );
  if (hasModelSelectionJson) {
    yield* sql`
      UPDATE projection_threads
      SET model = COALESCE(
        NULLIF(TRIM(model), ''),
        json_extract(model_selection_json, '$.model'),
        'gpt-5-codex'
      )
      WHERE model IS NULL OR TRIM(model) = ''
    `;
  } else {
    yield* sql`
      UPDATE projection_threads
      SET model = 'gpt-5-codex'
      WHERE model IS NULL OR TRIM(model) = ''
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
