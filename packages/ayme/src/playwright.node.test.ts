// The `./playwright` entry in Node, over real Playwright Chromium and against
// the built package: Ayme over a Page a Node host was handed (ADR-0049).
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium, type Browser, type Page } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type * as Playwright from "./playwright";

const dist = join(dirname(fileURLToPath(import.meta.url)), "../dist");

let built: typeof Playwright;
let browser: Browser;
const stops: (() => void)[] = [];

beforeAll(async () => {
  const entry = pathToFileURL(join(dist, "playwright.mjs")).href;
  // The Node lane loads what ships, by path, as builtEntries.test.ts reads it.
  // eslint-disable-next-line no-restricted-syntax
  built = (await import(entry)) as typeof Playwright;
  browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
  for (const stop of stops.splice(0)) stop();
  await browser?.close();
});

/** A page of its own context showing `body`. */
async function pageShowing(body: string): Promise<Page> {
  const page = await browser.newPage();
  await page.setContent(`<!doctype html><title>Ayme</title>${body}`);
  return page;
}

/** A Page Object rooted at `selector`, with one action that clicks its button. */
function pageObjectRootedAt(className: string, selector: string) {
  class Model {
    readonly root: ReturnType<Page["locator"]>;
    readonly button: ReturnType<Page["locator"]>;
    constructor(page: Page) {
      this.root = page.locator(selector);
      this.button = this.root.getByRole("button");
    }
    async press() {
      await this.button.click();
    }
  }
  Object.defineProperty(Model, "name", { value: className });
  built.ayme({ root: (self: Model) => self.root })(Model);
  built.registerCompiledPom(Model, {
    className,
    members: [
      { memberName: "root", kind: "locator", access: "field" },
      { memberName: "button", kind: "locator", access: "field" },
    ],
    tools: [
      {
        methodName: "press",
        toolName: `${className}.press`,
        description: "Press the button",
        parameters: [],
      },
    ],
    components: [],
  });
  return Model;
}

async function startedOn(
  page: Page,
  options: Omit<Playwright.PlaywrightAymeOptions, "page"> = {}
) {
  const ayme = built.createAyme({ page, ...options });
  stops.push(await ayme.start());
  return ayme;
}

describe("Ayme over a Playwright Page", () => {
  it("runs a live Page Object Tool and reports what it changed", async () => {
    const page = await pageShowing(
      '<section id="counter"><output>0</output><button>Add</button></section>' +
        "<script>document.querySelector('button').onclick = () => document.querySelector('output').textContent = '1'</script>"
    );
    const Counter = pageObjectRootedAt("Counter", "#counter");
    const ayme = await startedOn(page, { pageObjects: [Counter] });
    const { structure } = (await ayme.tools.run("snapshot", {})) as {
      structure: string;
    };
    const ref = /(e\d+)[^\n]*Counter/.exec(structure)?.[1];

    const result = await ayme.tools.run("Counter.press", { ref } as never);

    expect(JSON.stringify(result)).toContain("1");
    expect(await page.locator("output").textContent()).toBe("1");
  });

  it("clicks an element through a ref a snapshot printed", async () => {
    const page = await pageShowing(
      "<button>Save</button><p>Idle</p>" +
        "<script>document.querySelector('button').onclick = () => document.querySelector('p').textContent = 'Saved'</script>"
    );
    const ayme = await startedOn(page);
    const { structure } = (await ayme.tools.run("snapshot", {})) as {
      structure: string;
    };
    const ref = /- (e\d+) button "Save"/.exec(structure)?.[1];
    expect(ref, structure).toBeDefined();

    await ayme.tools.run("click", { target: ref! });

    expect(await page.locator("p").textContent()).toBe("Saved");
    expect(await page.locator(`ayme-ref=${ref}`).textContent()).toBe("Save");
  });

  it("runs a Custom Tool on the element a ref names, through a Locator", async () => {
    const page = await pageShowing("<button>Open</button><p>Closed</p>");
    const ayme = await startedOn(page, {
      customTools: [
        {
          name: "label_of",
          description: "Reads the text of an element",
          filter: "button",
          execute: ({ locator }) => locator.textContent(),
        },
      ],
    });
    const { structure } = (await ayme.tools.run("snapshot", {})) as {
      structure: string;
    };
    const ref = /- (e\d+) button "Open"/.exec(structure)![1]!;

    await expect(ayme.tools.run("label_of", { ref })).resolves.toMatchObject({
      result: "Open",
    });
  });

  it("refuses to start with a filter the page cannot run", async () => {
    const page = await pageShowing("<button>Save</button>");

    await expect(
      built.createAyme({ page, ignore: "[" }).start()
    ).rejects.toThrow("`ignore` is not a valid CSS selector");
  });

  it("keeps the Page Objects and sessions of two pages in one process apart", async () => {
    const first = await pageShowing(
      '<section id="counter"><button>First</button></section>'
    );
    const second = await pageShowing(
      '<section id="counter"><button>Second</button></section>'
    );
    const FirstModel = pageObjectRootedAt("FirstModel", "#counter");
    const firstAyme = await startedOn(first, { pageObjects: [FirstModel] });
    const secondAyme = await startedOn(second);

    const { structure: firstSees } = (await firstAyme.tools.run(
      "snapshot",
      {}
    )) as { structure: string };
    const { structure: secondSees } = (await secondAyme.tools.run(
      "snapshot",
      {}
    )) as { structure: string };

    expect(firstSees).toContain('button "First"');
    expect(firstSees).not.toContain("Second");
    expect(secondSees).toContain('button "Second"');
    expect(secondSees).not.toContain("First");
    await expect
      .poll(() => firstAyme.tools.list().map((tool) => tool.name))
      .toContain("FirstModel.press");
    expect(secondAyme.tools.list().map((tool) => tool.name)).not.toContain(
      "FirstModel.press"
    );
    expect(firstAyme.runs.list().length).toBeGreaterThan(0);
    expect(secondAyme.runs.list().map((run) => run.tool)).not.toContain(
      "FirstModel.press"
    );
  });
});
