import { ProviderDriverKind } from "@t3tools/contracts";
import { expect, it } from "vitest";

import { BUILT_IN_DRIVERS } from "./builtInDrivers.ts";

it("ships Pi as a built-in provider driver", () => {
  expect(BUILT_IN_DRIVERS.map((driver) => driver.driverKind)).toContain(
    ProviderDriverKind.make("pi"),
  );
});
