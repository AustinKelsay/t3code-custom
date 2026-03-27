import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

type TableColumnRow = {
  readonly name: string;
};

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const columns = yield* sql<TableColumnRow>`
    PRAGMA table_info(projection_turns)
  `;
  const hasSourceThreadId = columns.some(
    (column) => column.name === "source_proposed_plan_thread_id",
  );
  const hasSourcePlanId = columns.some((column) => column.name === "source_proposed_plan_id");

  if (!hasSourceThreadId) {
    yield* sql`
      ALTER TABLE projection_turns
      ADD COLUMN source_proposed_plan_thread_id TEXT
    `;
  }

  if (!hasSourcePlanId) {
    yield* sql`
      ALTER TABLE projection_turns
      ADD COLUMN source_proposed_plan_id TEXT
    `;
  }
});
