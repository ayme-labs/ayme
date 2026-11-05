import type { Page } from "@playwright/test";
import { expect, it } from "vitest";

import type { InPageHost } from "./inPage";

/**
 * One runtime the in-page module's contract runs on: Playwright Lite in the
 * browser, or real Playwright in Node against the built package.
 */
export type InPageLane = {
  /** A page showing a fresh, empty document. */
  newPage(): Promise<Page>;
  /** A new host, other than every one before it, of `version` or else this package's. */
  createHost(page: Page, version?: string): InPageHost;
  /** Loads the page's document again and answers the Page that shows the next one. */
  reload(page: Page): Promise<Page>;
  /** Whether a host outlives a full load of its page, as a Node host does and the page's own runtime does not. */
  hostsOutliveLoads: boolean;
};

/** The in-page module's contract, as every host sees it through `inPage(page)`. */
export function inPageContract(lane: InPageLane) {
  it("the first host installs the module and a later host binds to it", async () => {
    const page = await lane.newPage();
    const first = lane.createHost(page);
    const later = lane.createHost(page);

    const installed = await first.inPage(page).bound();
    const bound = await later.inPage(page).bound();

    expect(installed.installedBy).toBe(installed.host);
    expect(bound).toEqual({
      document: installed.document,
      version: installed.version,
      installedBy: installed.host,
      host: expect.any(String),
    });
    expect(bound.host).not.toBe(installed.host);
  });

  it("hosts that reach a document at once still share one module", async () => {
    const page = await lane.newPage();
    const hosts = [1, 2, 3].map(() => lane.createHost(page));

    const bound = await Promise.all(
      hosts.map((host) => host.inPage(page).bound())
    );

    expect(new Set(bound.map(({ document }) => document)).size).toBe(1);
    expect(new Set(bound.map(({ installedBy }) => installedBy)).size).toBe(1);
    expect(bound.map(({ host }) => host)).toContain(bound[0]!.installedBy);
  });

  it("a host has one InPage per Page and binds it as often as asked", async () => {
    const page = await lane.newPage();
    const host = lane.createHost(page);

    const first = await host.inPage(page).bound();
    const again = await host.inPage(page).bound();

    expect(host.inPage(page)).toBe(host.inPage(page));
    expect(again).toEqual(first);
  });

  it("a host of another version gets a version error, and the document keeps its one module", async () => {
    const page = await lane.newPage();
    const installed = await lane.createHost(page, "1.0.0").inPage(page).bound();

    await expect(
      lane.createHost(page, "2.0.0").inPage(page).bound()
    ).rejects.toMatchObject({
      name: "InPageVersionError",
      message:
        "This document runs Ayme's in-page module 1.0.0; this host is 2.0.0.",
    });
    const later = await lane.createHost(page, "1.0.0").inPage(page).bound();

    expect(later.document).toBe(installed.document);
    expect(later.installedBy).toBe(installed.host);
  });

  it("a page script cannot replace the module", async () => {
    const page = await lane.newPage();
    const installed = await lane.createHost(page).inPage(page).bound();

    // A string, so Playwright Lite runs it in the page's own realm too.
    const replaced = await page.evaluate(`(() => {
      const slot = Symbol.for("ayme.inPage");
      try {
        globalThis[slot] = undefined;
      } catch {
        // Strict code throws on the write; the module stays either way.
      }
      return Reflect.deleteProperty(globalThis, slot);
    })()`);
    const later = await lane.createHost(page).inPage(page).bound();

    expect(replaced).toBe(false);
    expect(later.document).toBe(installed.document);
    expect(later.installedBy).toBe(installed.host);
  });

  it("two pages have a module each", async () => {
    const [one, other] = [await lane.newPage(), await lane.newPage()];

    const [first, second] = [
      await lane.createHost(one).inPage(one).bound(),
      await lane.createHost(other).inPage(other).bound(),
    ];

    expect(second.document).not.toBe(first.document);
  });

  it("a full load gives the next document a new token and a module of its own", async () => {
    const page = await lane.newPage();
    const before = await lane.createHost(page).inPage(page).bound();

    const next = await lane.reload(page);
    const after = await lane.createHost(next).inPage(next).bound();

    expect(after.document).not.toBe(before.document);
    expect(after.installedBy).toBe(after.host);
  });

  it.runIf(lane.hostsOutliveLoads)(
    "a host that outlives a full load binds the next document, installing it there",
    async () => {
      const page = await lane.newPage();
      const host = lane.createHost(page);
      const before = await host.inPage(page).bound();

      const next = await lane.reload(page);
      const after = await host.inPage(next).bound();

      expect(after.document).not.toBe(before.document);
      expect(after.host).toBe(before.host);
      expect(after.installedBy).toBe(before.host);
    }
  );
}
