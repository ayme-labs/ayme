// The Playwright entry (ADR-0049): Ayme over a real Playwright Page, for a
// Node host. It composes the same session code and adapters as the browser
// runtime over the Page it is handed, and carries no browser code: no
// Playwright Lite, no document, no Inspector.
import { selectors } from "@playwright/test";
import {
  createPlaywrightAyme,
  type PlaywrightAyme,
  type PlaywrightAymeOptions,
} from "./runtime";
import { registerAymeRef } from "./in-page";

export type { PlaywrightAyme, PlaywrightAymeOptions };
export type { PageCustomTool } from "./tools/application";

/**
 * A runtime session over the Playwright `Page` `options.page`, inert until
 * `start()`, which resolves with the function that stops it. It registers
 * the `ayme-ref` engine on Playwright's `selectors`, once per process, so a
 * ref a page state prints resolves in the host's own Playwright calls.
 */
export function createAyme(options: PlaywrightAymeOptions): PlaywrightAyme {
  return createPlaywrightAyme(options, () => registerAymeRef(selectors));
}

// The in-page module's host side, which a Node host drives over its Page.
export {
  createInPageHost,
  inPage,
  InPageVersionError,
  registerAymeRef,
} from "./in-page";
export type {
  ActionOptions,
  Bound,
  Capture,
  CaptureOptions,
  ElementInputs,
  InPage,
  InPageAction,
  InPageHost,
  PickOptions,
  VisitSignal,
  RootState,
} from "./in-page";

// The Page Object registry over a Playwright page's in-page module.
export { ayme } from "./page-objects/domain";
export {
  createPomRegistry,
  registerCompiledPom,
} from "./page-objects/application";
export type { PageObjectConstructor } from "./page-objects/application";
export { inPageDriver } from "./page-objects/infrastructure";
