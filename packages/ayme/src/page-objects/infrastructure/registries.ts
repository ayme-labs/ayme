// The Page Object registry, kept per Page (ADR-0049): the browser runtime's
// is that of its own Playwright Lite page, a Node host's that of the Page it
// was handed, so two pages in one process register, probe and list Page
// Objects apart. Both read the page through the same driver over the
// document's in-page module.
import type { Page } from "@playwright/test";
import { inPage } from "../../in-page";
import {
  createPomRegistry,
  type PomPageStates,
  type PomRegistry,
} from "../application/pomRegistry";
import type { PageObjectIdSource } from "../application/pageObjectIds";
import { inPageDriver } from "./inPageDriver";

/** What a runtime session adds to its page's registry. */
export type PomRegistryHost = {
  pageStates: PomPageStates;
  /** Where the page's Page Object ids come from; the page's own when absent. */
  pageObjectIds?: PageObjectIdSource;
};

const registries = new WeakMap<Page, PomRegistry>();

/**
 * The registry of `page`, created on first use with `host`: a later host's
 * `pageObjectIds` is not read, since an id is never given to another Page
 * Object of the page.
 */
export function pomRegistryOf(page: Page, host: PomRegistryHost): PomRegistry {
  let found = registries.get(page);
  if (!found)
    registries.set(
      page,
      (found = createPomRegistry(
        inPageDriver(() => inPage(page)),
        host.pageStates,
        host.pageObjectIds
      ))
    );
  return found;
}
