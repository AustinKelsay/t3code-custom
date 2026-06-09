import { PiSettings, PROVIDER_DISPLAY_NAMES, ProviderDriverKind } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { PROVIDER_OPTIONS } from "./session-logic";
import {
  DRIVER_OPTION_BY_VALUE,
  PROVIDER_CLIENT_DEFINITIONS,
} from "./components/settings/providerDriverMeta";
import { PROVIDER_ICON_BY_PROVIDER } from "./components/chat/providerIconUtils";
import { COMING_SOON_DRIVER_OPTIONS } from "./components/settings/AddProviderInstanceDialog";

const PI_DRIVER = ProviderDriverKind.make("pi");

describe("Pi provider client catalog", () => {
  it("exposes Pi as an available provider with settings metadata", () => {
    const definition = DRIVER_OPTION_BY_VALUE[PI_DRIVER];

    expect(definition).toBeDefined();
    expect(definition?.label).toBe("Pi");
    expect(definition?.settingsSchema).toBe(PiSettings);
    expect(PROVIDER_CLIENT_DEFINITIONS.map((entry) => entry.value)).toContain(PI_DRIVER);
    expect(PROVIDER_OPTIONS.find((option) => option.value === PI_DRIVER)).toMatchObject({
      label: "Pi",
      available: true,
    });
    expect(PROVIDER_ICON_BY_PROVIDER[PI_DRIVER]).toBeDefined();
    expect(PROVIDER_DISPLAY_NAMES[PI_DRIVER]).toBe("Pi");
  });

  it("removes the placeholder Pi Agent entry from coming soon drivers", () => {
    expect(COMING_SOON_DRIVER_OPTIONS.map((option) => option.value)).not.toContain(
      ProviderDriverKind.make("piAgent"),
    );
    expect(COMING_SOON_DRIVER_OPTIONS.map((option) => option.value)).not.toContain(PI_DRIVER);
  });
});
