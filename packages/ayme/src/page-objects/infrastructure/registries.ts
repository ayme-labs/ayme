// The Page Object registry, kept per Page (ADR-0049): the browser runtime's
// is that of its own Playwright Lite page, a Node host's that of the Page it
// was handed, so two pages in one process register, probe and list Page
// Objects apart. Both read the page through the same driver over the
// document's in-page module.
import type { Page } from "@playwright/test";
import { inPage } from "../../in-page";
import type { LatestRefByRef } from "../../page-state/domain";
import {
  createPomRegistry,
  type PomElements,
  type PomRegistry,
} from "../application/pomRegistry";
import { inPageDriver } from "./inPageDriver";

/** What a runtime session adds to its page's registry. */
export type PomRegistryHost = {
  /** The Structural Ref the agent's latest page state gave what the in-page ref names. */
  latestPageStateRef: LatestRefByRef;
  elements: PomElements;
};

const registries = new WeakMap<Page, PomRegistry>();

/** The registry of `page`, created on first use with `host`. */
export function pomRegistryOf(page: Page, host: PomRegistryHost): PomRegistry {
  let found = registries.get(page);
  if (!found)
    registries.set(
      page,
      (found = createPomRegistry(
        inPageDriver(() => inPage(page), host.latestPageStateRef),
        host.elements
      ))
    );
  return found;
}
