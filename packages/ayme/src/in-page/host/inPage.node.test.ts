// The in-page module's contract in Node, over real Playwright Chromium and
// against the built package: real Playwright sends the install function's
// source into the page, so a function that closes over host state fails here.
// Beside it, the page's own runtime over Playwright Lite and a Node host share
// one document.
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  chromium,
  selectors,
  type Browser,
  type JSHandle,
  type Page,
} from "@playwright/test";
import { Rolldown } from "tsdown";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type * as Playwright from "../../playwright";
import { inPageContract } from "./inPageContract.testSupport";

// Playwright's overlay keeps its shadow root closed unless it runs under its own
// tests; the contract reads the highlight boxes it draws.
vi.hoisted(() => {
  process.env.PWTEST_UNDER_TEST = "1";
});

const dist = join(dirname(fileURLToPath(import.meta.url)), "../../../dist");
const origin = "http://ayme.test";

let built: typeof Playwright;
let browser: Browser;
// The page's own runtime: the built package in the page, over Playwright Lite.
let pageRuntime: string;

beforeAll(async () => {
  const entry = pathToFileURL(join(dist, "playwright.mjs")).href;
  // The Node lane loads what ships, by path, as builtEntries.test.ts reads it.
  // eslint-disable-next-line no-restricted-syntax
  built = (await import(entry)) as typeof Playwright;
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
                "  elementKeys: (refs) => inPage(createPage()).elementKeys(refs),",
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
  bound(): Promise<Playwright.Bound>;
  elementKeys: Playwright.InPage["elementKeys"];
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
    pageObjects: {
      get ayme() {
        return built.ayme;
      },
      get createPomRegistry() {
        return built.createPomRegistry;
      },
      get inPageDriver() {
        return built.inPageDriver;
      },
      get registerCompiledPom() {
        return built.registerCompiledPom;
      },
    },
    async reload(page) {
      await page.reload();
      return page;
    },
    async nextDocument(page) {
      await page.waitForEvent("load");
      return page;
    },
    hostsOutliveLoads: true,
  });
});

/** `page`, counting the calls that evaluate in it. */
function countingEvaluations(page: Page) {
  const counted = new Set<string | symbol>([
    "evaluate",
    "evaluateHandle",
    "$eval",
    "$$eval",
  ]);
  const evaluations: string[] = [];
  const counting = new Proxy(page, {
    get(target, property) {
      const member: unknown = Reflect.get(target, property);
      if (typeof member !== "function") return member;
      return (...args: unknown[]) => {
        if (counted.has(property)) evaluations.push(String(property));
        return (member as (...args: unknown[]) => unknown).apply(target, args);
      };
    },
  });
  return { page: counting, evaluations };
}

describe("an action in Node", () => {
  it("costs at most two evaluations: one before it, and one held through its settle", async () => {
    const raw = await newPage();
    await raw.evaluate(() => {
      document.body.innerHTML =
        '<button>Add</button><ul aria-label="Items"></ul>';
      document.querySelector("button")!.addEventListener("click", () => {
        for (let item = 1; item <= 3; item += 1)
          setTimeout(
            () =>
              document
                .querySelector("ul")!
                .insertAdjacentHTML("beforeend", `<li>Item ${item}</li>`),
            item * 100
          );
      });
    });
    const { page, evaluations } = countingEvaluations(raw);
    const node = built.createInPageHost().inPage(page);
    await node.bound();
    evaluations.length = 0;

    const action = await node.begin();
    const outcome = await action.perform(() => page.locator("button").click());

    expect(outcome).toMatchObject({
      kind: "settled",
      stable: true,
      after: { distilledText: expect.stringContaining("Item 3") },
    });
    expect(evaluations).toEqual(["evaluate", "evaluate"]);
  });

  it("answers a load it starts itself as a load of where the page went", async () => {
    const page = await newPage();
    const node = built.inPage(page);
    const before = await node.capture();

    const action = await node.begin();
    const outcome = await action.perform(() => page.goto(`${origin}/next`));

    expect(outcome).toMatchObject({ kind: "loading", url: `${origin}/next` });
    expect((await node.capture()).document).not.toBe(before.document);
  });

  it("answers a load that destroys the page's context while it settles as a load", async () => {
    const page = await newPage();
    await page.evaluate(() => {
      document.body.innerHTML = "<button>Busy</button>";
      // A second of activity, so the settle still waits when the load comes.
      document.querySelector("button")!.addEventListener("click", () => {
        const busy = setInterval(
          () => document.body.append(document.createElement("p")),
          50
        );
        setTimeout(() => clearInterval(busy), 1_000);
      });
    });
    const node = built.createInPageHost().inPage(page);
    const action = await node.begin();

    const outcome = await action.perform(async () => {
      await page.locator("button").click();
      setTimeout(() => void page.goto(`${origin}/next`).catch(() => {}), 200);
    });

    expect(outcome).toMatchObject({ kind: "loading" });
  });

  it("rejects a settle that fails for anything but a load", async () => {
    const page = await newPage();
    const node = built.createInPageHost().inPage(page);
    const elements = (await page.evaluateHandle(() => ({}))) as Extract<
      Playwright.ActionOptions["elements"],
      JSHandle
    >;
    const action = await node.begin({ elements });

    // The settle reads the inputs again, through a handle gone by then: the
    // evaluate's own error, and no load.
    await expect(action.perform(() => elements.dispose())).rejects.toThrow(
      "page.evaluate"
    );
  });
});

/** `page`, whose `exposeFunction` fails with `error` for the name it is given. */
function exposingFails(page: Page, error: (name: string) => Error): Page {
  return new Proxy(page, {
    get(target, property) {
      if (property === "exposeFunction")
        return (name: string) => Promise.reject(error(name));
      const member: unknown = Reflect.get(target, property);
      return typeof member === "function" ? member.bind(target) : member;
    },
  });
}

describe("a host's binding in Node", () => {
  it("is shared by a second Page object of one page, which finds it already registered", async () => {
    const raw = await newPage();
    const host = built.createInPageHost();
    const first = await host.inPage(raw).bound();
    const sameName = exposingFails(
      raw,
      (name) => new Error(`Function "${name}" has been already registered`)
    );

    expect(await host.inPage(sameName).bound()).toEqual(first);
  });

  it("lets any other failure to expose it through", async () => {
    const page = exposingFails(
      await newPage(),
      () => new Error("Target page, context or browser has been closed")
    );

    await expect(built.createInPageHost().inPage(page).bound()).rejects.toThrow(
      "Target page, context or browser has been closed"
    );
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

  it("the page's own runtime and a Node host get one key for one element", async () => {
    const page = await newPage();
    await page.evaluate(() => {
      document.body.innerHTML = "<button>Save</button>";
    });
    const node = built.inPage(page);
    const refs = await node.mint(page.locator("button"));

    const fromRuntime = await page.evaluate(
      (refs) =>
        (
          window as unknown as { aymePageRuntime: PageRuntime }
        ).aymePageRuntime.elementKeys(refs),
      refs
    );

    expect(fromRuntime).toEqual(await node.elementKeys(refs));
    expect(fromRuntime[0]?.key).toEqual(expect.any(String));
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
