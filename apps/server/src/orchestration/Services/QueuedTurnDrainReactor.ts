import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

export interface QueuedTurnDrainReactorShape {
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  readonly drain: Effect.Effect<void>;
}

export class QueuedTurnDrainReactor extends Context.Service<
  QueuedTurnDrainReactor,
  QueuedTurnDrainReactorShape
>()("t3/orchestration/Services/QueuedTurnDrainReactor") {}
