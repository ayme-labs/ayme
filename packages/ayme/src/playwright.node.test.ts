// The `./playwright` entry in Node, over real Playwright Chromium and against
// the built package: ayme over a Page a Node host was handed (ADR-0049).
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
  await page.setContent(`<!doctype html><title>ayme</title>${body}`);
  return page;
}

/** A Page Object rooted at `selector`, with one action that clicks its button. */
function pageObjectRootedAt(className: string, selector: string) {
  class Model {
    constructor(private readonly page: Page) {}
    get root(): ReturnType<Page["locator"]> {
      return this.page.locator(selector);
    }
    get button(): ReturnType<Page["locator"]> {
      return this.root.getByRole("button");
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
      { memberName: "root", kind: "locator", access: "getter" },
      { memberName: "button", kind: "locator", access: "getter" },
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

describe("ayme over a Playwright Page", () => {
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
            "<!doctype html><title>ayme</title>" +
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

  describe("Page Object ids", () => {
    /** The id of the Page Object of `className` that `ayme`'s snapshot shows. */
    async function idOf(ayme: Playwright.PlaywrightAyme, className: string) {
      let id: string | undefined;
      await expect
        .poll(async () => {
          id = new RegExp(`${className} (po\\d+)`).exec(
            await snapshot(ayme)
          )?.[1];
          return id;
        })
        .toBeDefined();
      return id!;
    }

    const counter =
      '<section id="counter"><output>0</output><button>Add</button></section>';

    it("are numbered per page when the Host gives no source", async () => {
      const Counter = pageObjectRootedAt("OwnCounter", "#counter");
      const first = await startedOn(await pageShowing(counter), {
        pageObjects: [Counter],
      });
      const second = await startedOn(await pageShowing(counter), {
        pageObjects: [Counter],
      });

      expect(await idOf(first, "OwnCounter")).toBe("po1");
      expect(await idOf(second, "OwnCounter")).toBe("po1");
    });

    it("come from the source the Host gives, so two pages that share it never give one id twice", async () => {
      const Counter = pageObjectRootedAt("SharedCounter", "#counter");
      const pageObjectIds = built.createPageObjectIdSource();
      const first = await startedOn(await pageShowing(counter), {
        pageObjects: [Counter],
        pageObjectIds,
      });
      const second = await startedOn(await pageShowing(counter), {
        pageObjects: [Counter],
        pageObjectIds,
      });

      expect(await idOf(first, "SharedCounter")).toBe("po1");
      expect(await idOf(second, "SharedCounter")).toBe("po2");
      await second.tools.run("SharedCounter.press", { id: "po2" } as never);
      await expect(
        second.tools.run("SharedCounter.press", { id: "po1" } as never)
      ).rejects.toThrow(/po1/);
    });
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
        body: `<!doctype html><title>ayme</title>${serve(new URL(route.request().url()))}`,
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

  describe("a Run whose action returns a Page Object, through a full load", () => {
    /**
     * A sign-in form whose submit loads `/landing`, a nearly
     * empty page whose script sends the browser on to `/home` after
     * `landingMs`; with a session over it whose `SignIn.logIn` submits,
     * returns `returnAfterMs` later, and returns a Home, present on `/home`.
     */
    async function signingIn(landingMs: number, returnAfterMs = 0) {
      const page = await browser.newPage();
      await page.route("http://app.test/**", (route) => {
        const { pathname } = new URL(route.request().url());
        return route.fulfill({
          contentType: "text/html",
          body:
            pathname === "/landing"
              ? `<script>setTimeout(() => location.assign("/home"), ${landingMs})</script>`
              : pathname === "/home"
                ? "<h1>Home</h1>"
                : '<form method="post" action="/landing"><button>Log in</button></form>',
        });
      });
      await page.goto("http://app.test/");
      class Home {
        constructor(readonly page: Page) {}
      }
      built.ayme({
        present: (self: Home) => new URL(self.page.url()).pathname === "/home",
      })(Home);
      class SignIn {
        constructor(readonly page: Page) {}
        async logIn() {
          await this.page.getByRole("button").click();
          await new Promise((resolve) => setTimeout(resolve, returnAfterMs));
          return new Home(this.page);
        }
      }
      built.registerCompiledPom(SignIn, {
        className: "SignIn",
        members: [],
        tools: [
          {
            methodName: "logIn",
            toolName: "SignIn.logIn",
            description: "Log in",
            parameters: [],
          },
        ],
        components: [],
      });
      const ayme = await startedOn(page, { pageObjects: [SignIn] });
      // A read lists the tool: a session lists none before it reads the page.
      await snapshot(ayme);
      return { page, ayme };
    }

    it("answers once the returned Page Object is present, past the page the load first brought", async () => {
      const { page, ayme } = await signingIn(600);

      await ayme.tools.run("SignIn.logIn", {});

      expect(page.url()).toBe("http://app.test/home");
    });

    it("counts the Settled Page deadline once, from the action's answer at the load's start, through the action returning", async () => {
      // The action returns 1.2 s after the answer; Home comes about 2.6 s
      // after it: past one deadline from the answer, within one from the
      // return.
      const { page, ayme } = await signingIn(2600, 1200);
      const started = Date.now();

      await ayme.tools.run("SignIn.logIn", {});

      expect(Date.now() - started).toBeGreaterThanOrEqual(1200);
      expect(page.url()).not.toBe("http://app.test/home");
    });
  });

  it("answers a navigate, a reload and a move back to another document with what changed before them", async () => {
    const page = await pageServing((url) =>
      url.pathname === "/two"
        ? "<p>Second document</p>"
        : "<p>First document</p>"
    );
    const ayme = await startedOn(page);
    await ayme.tools.run("snapshot", {});
    await page.evaluate(`document.querySelector("p").textContent = "Edited"`);
    const loading = (url: string) => ({
      settled: false,
      loading: url,
      next: `The page is loading ${url}. Call snapshot next to read the new page.`,
    });

    await expect(ayme.tools.run("navigate", { url: "/two" })).resolves.toEqual({
      page_changed: true,
      changes_before: expect.stringContaining("Edited"),
      ...loading("http://app.test/two"),
    });
    await ayme.tools.run("snapshot", {});
    await expect(ayme.tools.run("reload", {})).resolves.toEqual({
      page_changed: false,
      ...loading("http://app.test/two"),
    });
    await ayme.tools.run("snapshot", {});
    await expect(ayme.tools.run("navigate_back", {})).resolves.toEqual({
      page_changed: false,
      ...loading("http://app.test/"),
    });
  });

  it("answers a navigate whose router function changes the page and then loads another document without the changes it could not read", async () => {
    const page = await pageServing((url) =>
      url.pathname === "/two"
        ? "<p>Second document</p>"
        : "<p>First document</p>"
    );
    const ayme = await startedOn(page, {
      async navigate(url) {
        await page.evaluate(
          `document.querySelector("p").textContent = "Leaving"`
        );
        await page.goto(url);
      },
    });
    await ayme.tools.run("snapshot", {});

    await expect(
      ayme.tools.run("navigate", { url: "/two" })
    ).resolves.toStrictEqual({
      settled: false,
      loading: "http://app.test/two",
      next: "The page is loading http://app.test/two. What the action changed before the load could not be read. Call snapshot next to read the new page.",
    });
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
