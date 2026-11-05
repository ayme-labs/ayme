// The in-page module's contract in Node, over real Playwright Chromium and
// against the built package: real Playwright sends the install function's
// source into the page, so a function that closes over host state fails here.
// Beside it, the page's own runtime over Playwright Lite and a Node host share
// one document.
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium, selectors, type Browser, type Page } from "@playwright/test";
import { Rolldown } from "tsdown";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type * as Testing from "../../testing";
import { inPageContract } from "./inPageContract.testSupport";

// Playwright's overlay keeps its shadow root closed unless it runs under its own
// tests; the contract reads the highlight boxes it draws.
vi.hoisted(() => {
  process.env.PWTEST_UNDER_TEST = "1";
});

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
  await built.registerAymeRef(selectors);
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
                `import { createAyme, createPage } from ${JSON.stringify(join(dist, "index.mjs"))};`,
                `import { inPage } from ${JSON.stringify(join(dist, "testing.mjs"))};`,
                "let ayme;",
                "window.aymePageRuntime = {",
                "  bound: () => inPage(createPage()).bound(),",
                "  start() { ayme = createAyme(); ayme.start(); },",
                '  snapshot: async () => (await ayme.tools.run("snapshot", {})).structure,',
                "};",
              ].join("\n")
            : undefined,
      },
    ],
    output: { format: "iife", codeSplitting: false },
  });
  return output[0].code;
}

type PageRuntime = {
  bound(): Promise<Testing.Bound>;
  start(): void;
  snapshot(): Promise<string>;
};

const pageRuntimeOf = (page: Page) => ({
  start: () =>
    page.evaluate(() =>
      (
        window as unknown as { aymePageRuntime: PageRuntime }
      ).aymePageRuntime.start()
    ),
  snapshot: () =>
    page.evaluate(() =>
      (
        window as unknown as { aymePageRuntime: PageRuntime }
      ).aymePageRuntime.snapshot()
    ),
});

const pageRuntimeBound = (page: Page) =>
  page.evaluate(() =>
    (
      window as unknown as { aymePageRuntime: PageRuntime }
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

  it("the page's own runtime and a Node host share one ref world over 100 additions, and the runtime never refuses a capture", async () => {
    const page = await newPage();
    await page.evaluate(() => {
      document.body.innerHTML = '<ul aria-label="Items"></ul>';
    });
    const runtime = pageRuntimeOf(page);
    await runtime.start();
    const node = built.inPage(page);
    // Elements only one side ever sees, which a ref counter per copy of the
    // capture code would count on that side alone.
    const seenBy = async (capture: () => Promise<unknown>) => {
      await page.evaluate(() =>
        document.body.insertAdjacentHTML(
          "beforeend",
          '<div id="passing"><button>Passing</button><button>By</button></div>'
        )
      );
      await capture();
      await page.evaluate(() => document.getElementById("passing")!.remove());
    };
    await seenBy(() => node.capture());

    for (let item = 1; item <= 100; item += 1) {
      await page.evaluate((item) => {
        document
          .querySelector("ul")!
          .insertAdjacentHTML(
            "afterbegin",
            `<li><button>Item ${item}</button></li>`
          );
      }, item);
      // Node sees each new element before the page's runtime does, as in
      // tracer bullet 5, every other time.
      const nodeFirst = item % 2 === 1;
      if (item === 50) await seenBy(() => runtime.snapshot());
      const pageText = nodeFirst ? undefined : await runtime.snapshot();
      const { fullText } = await node.capture();
      const text = pageText ?? (await runtime.snapshot());

      const refs = [...fullText.matchAll(/\[ref=([^\]]+)\]/g)].map(
        ([, ref]) => ref
      );
      expect(new Set(refs).size, fullText).toBe(refs.length);
      const nodeRef = /- button "Item (\d+)" \[ref=(e\d+)\]/.exec(
        fullText.split("\n").find((line) => line.includes(`"Item ${item}"`))!
      )?.[2];
      expect(text).toContain(`- ${nodeRef} button "Item ${item}"`);
    }

    for (const item of [1, 50, 100]) {
      const { distilledText } = await node.capture();
      const ref = /\[ref=(e\d+)\]/.exec(
        distilledText
          .split("\n")
          .find((line) => line.includes(`"Item ${item}"`))!
      )![1];
      expect(await page.locator(`ayme-ref=${ref}`).textContent()).toBe(
        `Item ${item}`
      );
    }
  }, 120_000);
});
