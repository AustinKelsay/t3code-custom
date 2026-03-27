import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

type TableColumnRow = {
  readonly name: string;
};

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const columns = yield* sql<TableColumnRow>`
    PRAGMA table_info(projection_thread_proposed_plans)
  `;
  const hasImplementedAt = columns.some((column) => column.name === "implemented_at");
  const hasImplementationThreadId = columns.some(
    (column) => column.name === "implementation_thread_id",
  );

  if (!hasImplementedAt) {
    yield* sql`
      ALTER TABLE projection_thread_proposed_plans
      ADD COLUMN implemented_at TEXT
    `;
  }

  if (!hasImplementationThreadId) {
    yield* sql`
      ALTER TABLE projection_thread_proposed_plans
      ADD COLUMN implementation_thread_id TEXT
    `;
  }
});
