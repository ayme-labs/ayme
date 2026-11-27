// A Node Host's Inspector contract in Node, over real Playwright Chromium and
// against the built package, as a Session serves it to its Inspector window:
// what only this seam decides. The window, its Runs and its highlights are
// proved end to end in apps/mcp-fixture's inspectSession.spec.ts.
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium, selectors, type Browser, type Page } from "@playwright/test";
import { afterAll, beforeAll, expect, it, onTestFinished } from "vitest";

import type * as Internal from "../internal";
import type * as Playwright from "../playwright";

const dist = join(dirname(fileURLToPath(import.meta.url)), "../../dist");

let built: typeof Playwright;
let internal: typeof Internal;
let browser: Browser;

beforeAll(async () => {
  // The Node lane loads what ships, by path, as builtEntries.test.ts reads it.
  // eslint-disable-next-line no-restricted-syntax
  built = (await import(
    pathToFileURL(join(dist, "playwright.mjs")).href
  )) as typeof Playwright;
  // eslint-disable-next-line no-restricted-syntax
  internal = (await import(
    pathToFileURL(join(dist, "internal.mjs")).href
  )) as typeof Internal;
  browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
  await browser?.close();
});

/** A Page Object Model of a counter whose `add` adds one. */
function counterModel() {
  class Counter {
    constructor(readonly page: Page) {}
    get root(): ReturnType<Page["locator"]> {
      return this.page.locator("#counter");
    }
    get output(): ReturnType<Page["locator"]> {
      return this.root.locator("output");
    }
    async add() {
      await this.root.getByRole("button").click();
    }
  }
  built.ayme({ root: (self: Counter) => self.root })(Counter);
  built.registerCompiledPom(Counter, {
    className: "Counter",
    members: [
      { memberName: "root", kind: "locator", access: "getter" },
      { memberName: "output", kind: "locator", access: "getter" },
    ],
    tools: [
      {
        methodName: "add",
        toolName: "Counter.add",
        description: "Add one",
        parameters: [],
      },
    ],
    components: [],
  });
  return Counter;
}

/** A started Node Host over a page with a counter, and its Inspector
 * contract as a window reaches it. */
async function counterHost() {
  const page = await browser.newPage();
  onTestFinished(() => page.close());
  await page.setContent(
    '<!doctype html><title>Counter</title><section id="counter"><output>0</output><button>Add</button></section>' +
      "<script>document.querySelector('button').onclick = () => document.querySelector('output').textContent = String(Number(document.querySelector('output').textContent) + 1)</script>"
  );
  const ayme = internal.createNodeHost(
    { page, pageObjects: [counterModel()] },
    selectors
  );
  onTestFinished(await ayme.start());
  const port = internal.inspectorPortOf(ayme);
  return { page, ayme, port };
}

type State = {
  revision: number;
  tools: { name: string; group: string }[];
  pageObjects: { manifest: { className: string } }[];
  runs: { tool: string; by: string; status: string }[];
};

it("offers only the Page Object Tools: a Browser Tool is neither listed nor run", async () => {
  const { page, ayme, port } = await counterHost();
  await internal.pageObjectCallerOf(ayme, "ayme-command").listing();
  expect(ayme.tools.list().some(({ group }) => group === "browser")).toBe(true);

  const state = (await port.request("getState", undefined)) as State;
  const answer = (await port.request("runTool", {
    name: "click",
    input: { target: "e1" },
    by: "inspector",
  })) as { state: State; error?: string };

  expect(new Set(state.tools.map(({ group }) => group))).toEqual(
    new Set(["pageObject"])
  );
  expect(answer.error).toBe('There is no tool "click".');
  expect(answer.state.runs.map(({ tool }) => tool)).not.toContain("click");
  expect(await page.locator("output").textContent()).toBe("0");
});

it("answers a pick with no ref at once: a Node Host offers no tool that takes a Structural Ref", async () => {
  const { port } = await counterHost();

  const answer = (await port.request("pick", { id: "p1", refs: ["e1"] })) as {
    ref?: string;
  };

  expect(answer.ref).toBeUndefined();
});
