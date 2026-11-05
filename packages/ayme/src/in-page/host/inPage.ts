import type { JSHandle, Page, Selectors } from "@playwright/test";
import { aymeRefEngine, callInPage, installInPage } from "virtual:ayme-in-page";

import { version as packageVersion } from "../../../package.json";
import { AymeError, RuntimeStateError, type Capture } from "../../shared";
import type { Bound, ElementInputs, HostKey } from "../page/install";

export type {
  Bound,
  Capture,
  DocumentToken,
  ElementInputs,
  HostKey,
} from "../page/install";

/** The document runs another version's in-page module, so this host cannot use it. */
export class InPageVersionError extends AymeError {
  override readonly name = "InPageVersionError";
  readonly kind = "runtime";
}

/** The in-page module of the document a Page shows, as one host sees it. */
export type InPage = {
  /** Installs the module, or binds to the one there, and says what is there. */
  bound(): Promise<Bound>;
  /**
   * A capture of the document the Page shows now, binding to its module
   * first when needed. Records nothing.
   */
  capture(options?: CaptureOptions): Promise<Capture>;
};

export type CaptureOptions = {
  /**
   * Transitional: the host's Page Object Roots and ignore predicate as a
   * handle to live values in the page (`ElementInputs`), until the registry
   * probes in the page (#1175) and `ignore` takes a selector (#1177).
   */
  elements?: JSHandle<ElementInputs>;
};

/** A host: one side that drives pages through Playwright's Page. */
export type InPageHost = {
  /** The in-page module as this host sees it on `page`: one per Page. */
  inPage(page: Page): InPage;
};

/**
 * A host of `version`, this package's unless given. A host has one binding
 * in each Page, through which the module will call it.
 */
export function createInPageHost(version = packageVersion): InPageHost {
  const host = hostKey();
  const binding = `__ayme_${host}`;
  const pages = new WeakMap<Page, InPage>();

  const versionError = (found: string) =>
    new InPageVersionError(
      `This document runs Ayme's in-page module ${found}; this host is ${version}.`
    );

  function forPage(page: Page): InPage {
    let exposed: Promise<unknown> | undefined;
    const inPage: InPage = {
      async bound() {
        exposed ??= page.exposeFunction(binding, () => undefined);
        await exposed;
        const result = await page.evaluate(installInPage, {
          version,
          host,
          binding,
        });
        if (result.kind === "version") throw versionError(result.found);
        return result.bound;
      },
      async capture({ elements } = {}) {
        // A document without the module gets it installed, once.
        for (let installed = false; ; installed = true) {
          const result = await page.evaluate(callInPage, {
            version,
            host,
            name: "capture" as const,
            inputs: elements,
          });
          if (result.kind === "ok") return result.value as Capture;
          if (result.kind === "version") throw versionError(result.found);
          if (installed)
            throw new RuntimeStateError(
              "The document lost Ayme's in-page module right after it was installed."
            );
          await inPage.bound();
        }
      },
    };
    return inPage;
  }

  return {
    inPage(page) {
      let found = pages.get(page);
      if (!found) pages.set(page, (found = forPage(page)));
      return found;
    },
  };
}

function hostKey(): HostKey {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  );
}

const thisHost = createInPageHost();

/** The in-page module of the document `page` shows, as this host sees it. */
export function inPage(page: Page): InPage {
  return thisHost.inPage(page);
}

// Each runtime's selectors registry the engine is registered on.
const registered = new WeakSet<Selectors>();

/**
 * Registers the `ayme-ref` selector engine (ADR-0038) on a runtime's
 * `selectors`, Playwright Lite's or Playwright's, in the page's main world:
 * `ayme-ref=e5` then resolves through the document's in-page module, whichever
 * host captured it. Once per registry, before the pages that use it.
 */
export async function registerAymeRef(selectors: Selectors): Promise<void> {
  if (registered.has(selectors)) return;
  registered.add(selectors);
  await selectors.register("ayme-ref", aymeRefEngine);
}
