import type { Page } from "@playwright/test";
import { registerRefSelectorEngine } from "../page-state";
import { RuntimeStateError } from "../shared";
import { createPage } from "./browserPage";
import { resetRegisteredPoms } from "./registry";

// The runtime's page, which the Browser Tools read here, and the one runtime
// session that owns the Page Object registry.
let browserPage: Page | undefined;
let runtimeOwner: object | undefined;

export function requireAymeRuntimePage(): Page {
  if (!browserPage)
    throw new RuntimeStateError("The Ayme browser runtime is not configured.");
  return browserPage;
}

export function createAymeRuntime(page?: object) {
  if (runtimeOwner)
    throw new RuntimeStateError(
      "The Ayme runtime already has an active owner.",
      { code: "active-owner" }
    );

  resetRegisteredPoms();
  browserPage = undefined;
  const owner = {};
  const runtimePage = page ?? createPage();
  runtimeOwner = owner;
  browserPage = runtimePage as Page;
  // The page's locators for Structural Refs resolve through Ayme's engine.
  registerRefSelectorEngine();

  return {
    page: runtimePage,
    dispose() {
      if (runtimeOwner !== owner) return;
      resetRegisteredPoms();
      browserPage = undefined;
      runtimeOwner = undefined;
    },
  };
}
