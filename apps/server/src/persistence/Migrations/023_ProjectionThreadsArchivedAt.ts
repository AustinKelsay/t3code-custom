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

  const hasArchivedAt = columns.some((column) => column.name === "archived_at");
  if (!hasArchivedAt) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN archived_at TEXT
    `;
  }
});
