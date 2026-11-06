import type { Page } from "@playwright/test";
import { elementEverNamed } from "../../in-page";
import {
  latestPageStateRefNamed,
  onPageStateRecorded,
  pageOfDocument,
  providePageObjectProbe,
} from "../../page-state/infrastructure";
import type { PomRegistry } from "../application/pomRegistry";
import { pomRegistryOf } from "./registries";

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

// A server renders without a document, so without a Page: its registry
// stays empty under this key.
const serverPage = {} as Page;

/**
 * The browser runtime's Page Object registry: that of its document's
 * Playwright Lite page, which reads the page through the in-page module of
 * its document.
 */
export function browserRegistry(): PomRegistry {
  return pomRegistryOf(
    typeof document === "undefined" ? serverPage : pageOfDocument(document),
    {
      latestPageStateRef: latestPageStateRefNamed,
      elements: {
        // Transitional (#1182): this realm holds the document, so refs turn into
        // its elements.
        elementOf: elementEverNamed,
        onPageStateRecorded: (listener) =>
          onPageStateRecorded(document, listener),
        providePageObjectProbe,
      },
    }
  );
}

export const listAvailablePomTools: PomRegistry["listAvailablePomTools"] = () =>
  browserRegistry().listAvailablePomTools();
export const listRootedToolInstances: PomRegistry["listRootedToolInstances"] =
  () => browserRegistry().listRootedToolInstances();
export const listRegisteredPomRoots: PomRegistry["listRegisteredPomRoots"] =
  () => browserRegistry().listRegisteredPomRoots();
export const listRegisteredPomTargets: PomRegistry["listRegisteredPomTargets"] =
  () => browserRegistry().listRegisteredPomTargets();
export const listRegisteredPomTools: PomRegistry["listRegisteredPomTools"] =
  () => browserRegistry().listRegisteredPomTools();
export const listRegisteredPoms: PomRegistry["listRegisteredPoms"] = () =>
  browserRegistry().listRegisteredPoms();
export const probeRegisteredPomMembers: PomRegistry["probeRegisteredPomMembers"] =
  () => browserRegistry().probeRegisteredPomMembers();
export const registerPageObject: PomRegistry["registerPageObject"] = (
  ...args
) => browserRegistry().registerPageObject(...args);
export const resetRegisteredPoms: PomRegistry["resetRegisteredPoms"] = () =>
  browserRegistry().resetRegisteredPoms();
export const subscribeToRegisteredPoms: PomRegistry["subscribeToRegisteredPoms"] =
  (listener) => browserRegistry().subscribeToRegisteredPoms(listener);
