import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

type TableColumnRow = {
  readonly name: string;
};

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Older desktop builds reused migration ids 14/15 for different changes.
  // Existing databases can therefore miss later target-related schema even
  // though the migrator believes those ids already ran.
  const providerSessionRuntimeColumns = yield* sql<TableColumnRow>`
    PRAGMA table_info(provider_session_runtime)
  `;
  const hasProviderSessionRuntimeTargetId = providerSessionRuntimeColumns.some(
    (column) => column.name === "target_id",
  );
  if (!hasProviderSessionRuntimeTargetId) {
    yield* sql`
      ALTER TABLE provider_session_runtime
      ADD COLUMN target_id TEXT NOT NULL DEFAULT 'local'
    `;
  }
  yield* sql`
    UPDATE provider_session_runtime
    SET target_id = 'local'
    WHERE target_id IS NULL OR TRIM(target_id) = ''
  `;

  const projectionThreadColumns = yield* sql<TableColumnRow>`
    PRAGMA table_info(projection_threads)
  `;
  const hasProjectionThreadsTargetId = projectionThreadColumns.some(
    (column) => column.name === "target_id",
  );
  if (!hasProjectionThreadsTargetId) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN target_id TEXT NOT NULL DEFAULT 'local'
    `;
  }
  yield* sql`
    UPDATE projection_threads
    SET target_id = 'local'
    WHERE target_id IS NULL OR TRIM(target_id) = ''
  `;

  const projectionThreadSessionColumns = yield* sql<TableColumnRow>`
    PRAGMA table_info(projection_thread_sessions)
  `;
  const hasProjectionThreadSessionsTargetId = projectionThreadSessionColumns.some(
    (column) => column.name === "target_id",
  );
  if (!hasProjectionThreadSessionsTargetId) {
    yield* sql`
      ALTER TABLE projection_thread_sessions
      ADD COLUMN target_id TEXT NOT NULL DEFAULT 'local'
    `;
  }
  yield* sql`
    UPDATE projection_thread_sessions
    SET target_id = 'local'
    WHERE target_id IS NULL OR TRIM(target_id) = ''
  `;

  const projectionProjectColumns = yield* sql<TableColumnRow>`
    PRAGMA table_info(projection_projects)
  `;
  const hasProjectionProjectsTargetId = projectionProjectColumns.some(
    (column) => column.name === "target_id",
  );
  if (!hasProjectionProjectsTargetId) {
    yield* sql`
      ALTER TABLE projection_projects
      ADD COLUMN target_id TEXT NOT NULL DEFAULT 'local'
    `;
  }
  yield* sql`
    UPDATE projection_projects
    SET target_id = 'local'
    WHERE target_id IS NULL OR TRIM(target_id) = ''
  `;

  const hasProjectionProjectsColor = projectionProjectColumns.some(
    (column) => column.name === "color",
  );
  if (!hasProjectionProjectsColor) {
    yield* sql`
      ALTER TABLE projection_projects
      ADD COLUMN color TEXT DEFAULT NULL
    `;
  }

  yield* sql`
    CREATE TABLE IF NOT EXISTS execution_targets (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      label TEXT NOT NULL,
      connection_json TEXT NOT NULL,
      capabilities_json TEXT NOT NULL,
      health_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS thread_notes (
      thread_id TEXT PRIMARY KEY,
      notes TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_thread_notes_updated_at
    ON thread_notes(updated_at)
  `;
});
