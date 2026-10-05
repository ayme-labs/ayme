import { afterEach, expect, it, vi } from "vitest";

import { readDecisionProvider, readModelKeys } from "../scripts/appEnvironment";

afterEach(() => {
  vi.unstubAllEnvs();
});

it("uses the TypeSafe key when both keys are set, and lists both", () => {
  vi.stubEnv("AYME_TYPESAFE_API_KEY", "typesafe-key");
  vi.stubEnv("AYME_OPENROUTER_API_KEY", "openrouter-key");

  expect(readDecisionProvider()).toEqual({
    provider: "typesafe",
    apiKey: "typesafe-key",
  });
  expect(readModelKeys()).toEqual([
    { provider: "typesafe", apiKey: "typesafe-key" },
    { provider: "openrouter", apiKey: "openrouter-key" },
  ]);
});

it("uses the OpenRouter key when it is the only one set", () => {
  vi.stubEnv("AYME_TYPESAFE_API_KEY", "");
  vi.stubEnv("AYME_OPENROUTER_API_KEY", "openrouter-key");

  expect(readDecisionProvider()).toEqual({
    provider: "openrouter",
    apiKey: "openrouter-key",
  });
});
