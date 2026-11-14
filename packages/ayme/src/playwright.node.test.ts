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

/** The structure a `snapshot` of the session's page prints. */
async function snapshot(ayme: Playwright.PlaywrightAyme): Promise<string> {
  const { structure } = (await ayme.tools.run("snapshot", {})) as {
    structure: string;
  };
  return structure;
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
    const id = /Counter (po\d+)/.exec(structure)?.[1];
    expect(id, structure).toBeDefined();

    const result = await ayme.tools.run("Counter.press", { id } as never);

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

  describe("a Locator filter", () => {
    const panels =
      '<main><button>Save</button></main><aside aria-label="Assistant"><button>Get help</button></aside><aside aria-label="Notes"><button>Read notes</button></aside>';

    it("leaves out what its Locator matches by role and a name it reads from the code around it", async () => {
      const page = await pageShowing(panels);
      const assistant = "Assistant";
      const ayme = await startedOn(page, {
        ignore: (session) =>
          session.getByRole("complementary", { name: assistant }),
      });

      const structure = await snapshot(ayme);

      expect(structure).toContain("Save");
      expect(structure).toContain("Read notes");
      expect(structure).not.toContain("Get help");
    });

    it("leaves out an element added after the session started, once its Locator matches it at the next capture", async () => {
      const page = await pageShowing("<main><button>Save</button></main>");
      const ayme = await startedOn(page, {
        ignore: (session) =>
          session.getByRole("complementary", { name: "Assistant" }),
      });
      expect(await snapshot(ayme)).toContain("Save");

      await page.evaluate(
        `document.body.insertAdjacentHTML("beforeend", '<aside aria-label="Assistant"><button>Get help</button></aside>')`
      );

      const structure = await snapshot(ayme);
      expect(structure).toContain("Save");
      expect(structure).not.toContain("Get help");
    });

    it("leaves out of an action's own changes what the action adds and its Locator matches, so nothing shows as removed after", async () => {
      const page = await pageShowing(
        "<button>Notify</button><button>Other</button>" +
          `<script>document.querySelector("button").onclick = () => document.body.insertAdjacentHTML("beforeend", '<div role="status">Saved</div>')</script>`
      );
      const ayme = await startedOn(page, {
        ignore: (session) => session.getByRole("status"),
      });
      const structure = await snapshot(ayme);
      const refOf = (name: string) =>
        new RegExp(`- (e\\d+) button "${name}"`).exec(structure)![1]!;

      const clicked = (await ayme.tools.run("click", {
        target: refOf("Notify"),
      })) as { changes?: string };
      const next = (await ayme.tools.run("click", {
        target: refOf("Other"),
      })) as { changes_before?: string };

      expect(await page.getByRole("status").textContent()).toBe("Saved");
      expect(clicked.changes ?? "").not.toContain("Saved");
      expect(next.changes_before).toBeUndefined();
      expect(await snapshot(ayme)).not.toContain("Saved");
    });

    it("matches nothing inside a frame, whose document no capture reads, and the snapshot is still taken", async () => {
      const page = await pageShowing(
        '<main><button>Save</button></main><iframe srcdoc="<button>Inside the frame</button><div class=private>Secret</div>"></iframe>'
      );
      await page.frameLocator("iframe").getByRole("button").waitFor();
      const ayme = await startedOn(page, {
        ignore: (session) => session.frameLocator("iframe").locator(".private"),
      });

      const structure = await snapshot(ayme);

      expect(structure).toContain("Save");
      expect(structure).toContain("iframe");
      expect(structure).not.toContain("Inside the frame");
    });

    it("works on a page whose Content Security Policy forbids evaluating code", async () => {
      const page = await browser.newPage();
      await page.route("http://ayme.test/", (route) =>
        route.fulfill({
          contentType: "text/html",
          headers: { "content-security-policy": "script-src 'unsafe-inline'" },
          body:
            "<!doctype html><title>Ayme</title>" +
            panels +
            '<script>try { new Function("return 1"); window.evaluates = true } catch { window.evaluates = false }</script>',
        })
      );
      await page.goto("http://ayme.test/");
      expect(await page.evaluate("window.evaluates")).toBe(false);

      const ayme = await startedOn(page, {
        ignore: (session) =>
          session.getByRole("complementary", { name: "Assistant" }),
      });

      const structure = await snapshot(ayme);
      expect(structure).toContain("Read notes");
      expect(structure).not.toContain("Get help");
    });

    it("refuses to start when its function throws or returns no Locator, naming the filter", async () => {
      const page = await pageShowing(panels);
      const tool = (filter: Playwright.CustomTool["filter"]) => ({
        name: "label_of",
        description: "Reads the text of an element",
        filter,
        execute: () => Promise.resolve(null),
      });

      const threw = built
        .createAyme({
          page,
          ignore: () => {
            throw new Error("no panel yet");
          },
        })
        .start();
      const gaveNone = built
        .createAyme({ page, customTools: [tool((() => "aside") as never)] })
        .start();

      // The built package has its own class: the error is told by its name.
      await expect(threw).rejects.toMatchObject({
        name: "ToolInputError",
        message:
          "The `ignore` function threw when the session started: no panel yet",
      });
      await expect(gaveNone).rejects.toMatchObject({
        name: "ToolInputError",
        message: expect.stringContaining(
          "The `filter` of the Custom Tool `label_of` function did not return a Locator."
        ),
      });
    });
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

  /** A page at `http://app.test/` whose documents are what `serve` answers per URL. */
  async function pageServing(
    serve: (url: URL) => string,
    first = "http://app.test/"
  ): Promise<Page> {
    const page = await browser.newPage();
    await page.route("http://app.test/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><title>Ayme</title>${serve(new URL(route.request().url()))}`,
      })
    );
    await page.goto(first);
    return page;
  }

  it("starts over in a reloaded document, whose refs recycle the old document's", async () => {
    let loads = 0;
    const page = await pageServing(
      () =>
        `<button onclick="document.title = 'clicked'">${++loads === 1 ? "Old" : "New"}</button>`
    );
    const ayme = await startedOn(page);
    const { structure } = (await ayme.tools.run("snapshot", {})) as {
      structure: string;
    };
    const ref = /- (e\d+) button "Old"/.exec(structure)?.[1];
    expect(ref, structure).toBeDefined();
    await page.reload();

    const result = (await ayme.tools.run("click", { target: ref! })) as object;

    expect(await page.title()).toBe("clicked");
    // Not the old document's button turning into the new one's, under one ref.
    expect(result).not.toHaveProperty("changes_before");
    expect(JSON.stringify(result)).not.toContain("Old");
  });

  it("answers an action that loads another document with that load alone", async () => {
    const page = await pageServing((url) =>
      url.pathname === "/two"
        ? "<p>Second document</p>"
        : '<a href="/two">Next</a><p>First document</p>'
    );
    const Next = pageObjectRootedAt("Next", "body");
    const ayme = await startedOn(page, { pageObjects: [Next] });
    const { structure } = (await ayme.tools.run("snapshot", {})) as {
      structure: string;
    };
    const ref = /- (e\d+) link "Next"/.exec(structure)?.[1];
    expect(ref, structure).toBeDefined();

    const result = (await ayme.tools.run("click", { target: ref! })) as {
      loading?: string;
    };

    expect(result.loading).toBe("http://app.test/two");
    expect(JSON.stringify(result)).not.toContain("Second document");
  });

  it("takes a screenshot with its size", async () => {
    const page = await pageShowing("<h1>Shot</h1>");
    const ayme = await startedOn(page);

    const result = (await ayme.tools.run("screenshot", {})) as {
      width: number;
      height: number;
      mimeType: string;
    };

    expect(result).toMatchObject({ mimeType: "image/png" });
    expect(result.width).toBe(page.viewportSize()!.width);
    expect(result.height).toBe(page.viewportSize()!.height);
  });

  it("resolves a relative navigation against the document's base URL", async () => {
    const page = await pageServing(
      () => '<base href="/sub/"><p>Page</p>',
      "http://app.test/a/page"
    );
    const ayme = await startedOn(page);

    await ayme.tools.run("navigate", { url: "next" });

    expect(page.url()).toBe("http://app.test/sub/next");
  });

  describe("going back and forward over entries that keep the URL", () => {
    /** A page that pushes a state-only entry per click and shows the state on `popstate`. */
    async function pushingPage() {
      const page = await pageServing(
        () => `<h1>Step 0</h1><button>Next</button><script>
          let step = 0;
          document.querySelector("button").onclick = () => {
            history.pushState({ step: ++step }, "");
            document.querySelector("h1").textContent = "Step " + step;
          };
          addEventListener("popstate", (event) => {
            step = event.state?.step ?? 0;
            document.querySelector("h1").textContent = "Step " + step;
          });
        </script>`
      );
      const ayme = await startedOn(page);
      await ayme.tools.run("snapshot", {});
      await page.getByRole("button", { name: "Next" }).click();
      return { page, ayme };
    }

    it("reports a move back over a state-only entry, with the change it made", async () => {
      const { page, ayme } = await pushingPage();

      const result = (await ayme.tools.run("navigate_back", {})) as {
        result?: string;
        page_changed: boolean;
      };

      expect(await page.locator("h1").textContent()).toBe("Step 0");
      expect(result.result ?? "").not.toContain("no history entry");
      expect(result.page_changed).toBe(true);
      expect(JSON.stringify(result)).toContain("Step 0");
    });

    it("reports a move forward over one, and still reports no entry when there is none", async () => {
      const { page, ayme } = await pushingPage();
      await ayme.tools.run("navigate_back", {});

      const forward = (await ayme.tools.run("navigate_forward", {})) as {
        result?: string;
      };
      const none = (await ayme.tools.run("navigate_forward", {})) as {
        result?: string;
      };

      expect(await page.locator("h1").textContent()).toBe("Step 1");
      expect(forward.result ?? "").not.toContain("no history entry");
      expect(none.result).toBe(
        "There is no history entry to go forward to; the page did not move."
      );
    });
  });
});
