import { registerRefSelectorEngine } from "../../page-state/infrastructure";
import { RuntimeStateError } from "../../shared";
import { createPage } from "./browserPage";
import { resetRegisteredPoms } from "./registry";

// The one runtime session that owns the Page Object registry.
let runtimeOwner: object | undefined;

export function createAymeRuntime(page?: object) {
  if (runtimeOwner)
    throw new RuntimeStateError(
      "The Ayme runtime already has an active owner.",
      { code: "active-owner" }
    );

  resetRegisteredPoms();
  const owner = {};
  const runtimePage = page ?? createPage();
  runtimeOwner = owner;
  // The page's locators for Structural Refs resolve through Ayme's engine.
  registerRefSelectorEngine();

  return {
    page: runtimePage,
    dispose() {
      if (runtimeOwner !== owner) return;
      resetRegisteredPoms();
      runtimeOwner = undefined;
    },
  };
}
