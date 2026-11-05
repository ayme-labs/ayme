// The in-page module's contract in Node, over real Playwright Chromium and
// against the built package: real Playwright sends the install function's
// source into the page, so a function that closes over host state fails here.
// Beside it, the page's own runtime over Playwright Lite and a Node host share
// one document.
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium, type Browser, type Page } from "@playwright/test";
import { Rolldown } from "tsdown";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type * as Testing from "../../testing";
import { inPageContract } from "./inPageContract.testSupport";

const dist = join(dirname(fileURLToPath(import.meta.url)), "../../../dist");
const origin = "http://ayme.test";

let built: typeof Testing;
let browser: Browser;
// The page's own runtime: the built package in the page, over Playwright Lite.
let pageRuntime: string;

beforeAll(async () => {
  const testing = pathToFileURL(join(dist, "testing.mjs")).href;
  // The Node lane loads what ships, by path, as builtEntries.test.ts reads it.
  // eslint-disable-next-line no-restricted-syntax
  built = (await import(testing)) as typeof Testing;
  pageRuntime = await bundlePageRuntime();
  browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
  await browser?.close();
});

/** A page of its own context, on an empty document that may run the page's own runtime. */
async function newPage(): Promise<Page> {
  const page = await browser.newPage();
  await page.route(`${origin}/**`, (route) =>
    route.request().url() === `${origin}/runtime.js`
      ? route.fulfill({ contentType: "text/javascript", body: pageRuntime })
      : route.fulfill({
          contentType: "text/html",
          body: '<!doctype html><title>In-page module</title><script src="/runtime.js"></script>',
        })
  );
  await page.goto(`${origin}/`);
  return page;
}

/**
 * The built entries as the page's own runtime uses them, in one script: it
 * binds this document through `aymePageRuntime.bound()`.
 */
async function bundlePageRuntime(): Promise<string> {
  const entry = "\0page-runtime";
  const { output } = await Rolldown.build({
    input: entry,
    platform: "browser",
    write: false,
    // Optional peers the runtime imports lazily, which these tests never load.
    external: [/^@ayme-dev\/(inspector|mcp|webmcp)(\/|$)/],
    plugins: [
      {
        name: "page-runtime",
        resolveId: (id) => (id === entry ? entry : undefined),
        load: (id) =>
          id === entry
            ? [
                `import { createPage } from ${JSON.stringify(join(dist, "index.mjs"))};`,
                `import { inPage } from ${JSON.stringify(join(dist, "testing.mjs"))};`,
                "window.aymePageRuntime = { bound: () => inPage(createPage()).bound() };",
              ].join("\n")
            : undefined,
      },
    ],
    output: { format: "iife", codeSplitting: false },
  });
  return output[0].code;
}

const pageRuntimeBound = (page: Page) =>
  page.evaluate(() =>
    (
      window as unknown as {
        aymePageRuntime: { bound(): Promise<Testing.Bound> };
      }
    ).aymePageRuntime.bound()
  );

describe("the in-page module over real Playwright, as built", () => {
  inPageContract({
    newPage,
    createHost: (_page, version) => built.createInPageHost(version),
    async reload(page) {
      await page.reload();
      return page;
    },
    hostsOutliveLoads: true,
  });
});

describe("the page's own runtime and a Node host on one document", () => {
  it("the Node host binds to the module the page's runtime installed", async () => {
    const page = await newPage();

    const runtime = await pageRuntimeBound(page);
    const node = await built.inPage(page).bound();

    expect(runtime.installedBy).toBe(runtime.host);
    expect(node.document).toBe(runtime.document);
    expect(node.installedBy).toBe(runtime.host);
    expect(node.host).not.toBe(runtime.host);
  });

  it("the page's runtime binds to the module a Node host installed", async () => {
    const page = await newPage();

    const node = await built.inPage(page).bound();
    const runtime = await pageRuntimeBound(page);

    expect(node.installedBy).toBe(node.host);
    expect(runtime.document).toBe(node.document);
    expect(runtime.installedBy).toBe(node.host);
  });

  it("a Node host of another version gets a version error from the page's module", async () => {
    const page = await newPage();
    const runtime = await pageRuntimeBound(page);

    await expect(
      built.createInPageHost("0.0.0-other").inPage(page).bound()
    ).rejects.toThrow(
      `This document runs Ayme's in-page module ${runtime.version}; this host is 0.0.0-other.`
    );
    expect((await built.inPage(page).bound()).installedBy).toBe(runtime.host);
  });
});
