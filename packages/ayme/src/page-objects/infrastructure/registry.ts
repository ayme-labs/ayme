import { elementEverNamed } from "../../in-page";
import {
  browserInPage,
  latestPageStateRefNamed,
  onPageStateRecorded,
} from "../../page-state/infrastructure";
import { createPomRegistry } from "../application/pomRegistry";
import { inPageDriver } from "./inPageDriver";

// The registry's interface includes registering the compiled manifests its
// registrations read.
export {
  constructPageObject,
  registerCompiledPom,
  type PageObjectConstructor,
} from "../application/compiledPoms";
export type {
  CallerAwarePomTool,
  RootedToolInstance,
  RegisteredPom,
  RegisteredPomRoot,
} from "../application/pomRegistry";

/**
 * The browser runtime's Page Object registry, which reads the page through
 * the in-page module of its document, over Playwright Lite.
 */
export const {
  listAvailablePomTools,
  listRootedToolInstances,
  listRegisteredPomRoots,
  listRegisteredPomTargets,
  listRegisteredPomTools,
  listRegisteredPoms,
  probeRegisteredPomMembers,
  registerPageObject,
  resetRegisteredPoms,
  subscribeToRegisteredPoms,
} = createPomRegistry(
  inPageDriver(() => browserInPage(), latestPageStateRefNamed),
  {
    // Transitional (#1182): this realm holds the document, so refs turn into
    // its elements.
    elementOf: elementEverNamed,
    onPageStateRecorded: (listener) => onPageStateRecorded(document, listener),
  }
);
