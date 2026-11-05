import type { Page } from "@playwright/test";
import { installInPage } from "virtual:ayme-in-page";

import { version as packageVersion } from "../../../package.json";
import { AymeError } from "../../shared";
import type { Bound, HostKey } from "../page/install";

export type { Bound, DocumentToken, HostKey } from "../page/install";

/** The document runs another version's in-page module, so this host cannot use it. */
export class InPageVersionError extends AymeError {
  override readonly name = "InPageVersionError";
  readonly kind = "runtime";
}

/** The in-page module of the document a Page shows, as one host sees it. */
export type InPage = {
  /** Installs the module, or binds to the one there, and says what is there. */
  bound(): Promise<Bound>;
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

  function forPage(page: Page): InPage {
    let exposed: Promise<unknown> | undefined;
    return {
      async bound() {
        exposed ??= page.exposeFunction(binding, () => undefined);
        await exposed;
        const result = await page.evaluate(installInPage, {
          version,
          host,
          binding,
        });
        if (result.kind === "version")
          throw new InPageVersionError(
            `This document runs Ayme's in-page module ${result.found}; this host is ${version}.`
          );
        return result.bound;
      },
    };
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
