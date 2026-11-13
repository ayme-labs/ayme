import { createServer } from "node:http";
import { createServer as createNetServer, type AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { Effect, ManagedRuntime, Queue } from "effect";
import {
  chromium,
  type BrowserContext,
  type Locator,
  type Page,
} from "playwright-core";
import { afterEach, expect, it } from "vitest";

import { RecordedBrowser } from "../../session/application";
import type { BrowserRequest, BrowserSignal } from "../../session/domain";
import { stockBrowser } from "./stockBrowser";

// The recorded browser's contract, on stock Playwright. Each private detail
// of Playwright the adapter uses has its test here (ADR-0052), and every
// test speaks only the seam's words: requests asked, signals told. CI runs
// this file once per supported Playwright version, and the weekly canary
// against the newest one.
//
// The Playwright under test is the one installed in the project folder that
// AYME_RECORDER_PLAYWRIGHT_PROJECT names, or else this package's own. To add
// a private detail, add one test that uses `onStockPlaywright`.
//
// The suite runs twice (vitest.contract.config.ts): on a browser the adapter
// launches, and, with AYME_RECORDER_BROWSER=attach, on a browser that is
// already running, with its page open, when the adapter attaches to it. That
// browser is the test's own: it launched it, and its connection is another
// automation client in the recorded browser.
const attaching = process.env.AYME_RECORDER_BROWSER === "attach";

const projectDir =
  process.env.AYME_RECORDER_PLAYWRIGHT_PROJECT ??
  fileURLToPath(new URL("../../..", import.meta.url));

/** A recorded browser on stock Playwright, as the engine sees it. */
type Harness = {
  ask(request: BrowserRequest): Promise<void>;
  /** Everything told so far, in order. */
  readonly told: readonly BrowserSignal[];
  /** Resolves with the first signal told that matches. */
  toldOf<K extends BrowserSignal["kind"]>(
    kind: K,
    matches?: (signal: Extract<BrowserSignal, { kind: K }>) => boolean
  ): Promise<Extract<BrowserSignal, { kind: K }>>;
  /** The recorded page, over the test's own connection to the browser. */
  readonly page: Page;
  /** A person at the recorded browser: raw input over that connection, so
   * that it is no call of the Playwright under test. */
  click(target: Locator): Promise<void>;
  /** Closes the layer's scope, as the end of a recorder does. */
  letGo(): Promise<void>;
};

const ends: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const end of ends.splice(0).reverse()) await end();
});

const freePort = () =>
  new Promise<number>((resolve) => {
    const server = createNetServer().listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolve(port));
    });
  });

/** Serves one page of HTML, and opens the recorded browser on it. */
async function onStockPlaywright(html: string): Promise<Harness> {
  const server = createServer((_, response) => {
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(`<!doctype html><html><body>${html}</body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  ends.push(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      })
  );
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  const debugPort = await freePort();

  let running: BrowserContext | undefined;
  if (attaching) {
    // Someone else's browser, open on the page before the recorder comes.
    running = await chromium.launchPersistentContext("", {
      headless: true,
      args: [`--remote-debugging-port=${debugPort}`],
    });
    const open = running;
    ends.push(() => open.close());
    await open.pages()[0]!.goto(url);
  }
  const runtime = ManagedRuntime.make(
    attaching
      ? stockBrowser({
          projectDir,
          cdpEndpoint: `http://127.0.0.1:${debugPort}`,
        })
      : stockBrowser({ projectDir, url, headless: true, debugPort })
  );
  ends.push(() => runtime.dispose());
  const browser = await runtime.runPromise(RecordedBrowser);
  const told: BrowserSignal[] = [];
  runtime.runFork(
    Effect.forever(
      Queue.take(browser.signals).pipe(
        Effect.map((signal) => told.push(signal))
      )
    )
  );

  let contexts: BrowserContext[];
  if (running) contexts = [running];
  else {
    const connection = await chromium.connectOverCDP(
      `http://127.0.0.1:${debugPort}`
    );
    ends.push(() => connection.close());
    contexts = connection.contexts();
  }
  const page = contexts
    .flatMap((context) => context.pages())
    .find((candidate) => candidate.url() === url);
  if (!page) throw new Error(`No page at ${url} in the recorded browser.`);
  const session = await page.context().newCDPSession(page);
  const mouse = (type: string, at: { x: number; y: number }, buttons: number) =>
    session.send("Input.dispatchMouseEvent", {
      type: type as "mouseMoved",
      x: at.x,
      y: at.y,
      button: type === "mouseMoved" ? "none" : "left",
      buttons,
      clickCount: 1,
      pointerType: "mouse",
    });

  return {
    ask: (request) => runtime.runPromise(browser.ask(request)),
    told,
    toldOf: async (kind, matches = () => true) => {
      const found = () =>
        told.find(
          (signal): signal is Extract<BrowserSignal, { kind: typeof kind }> =>
            signal.kind === kind && matches(signal as never)
        );
      await expect.poll(found, { timeout: 10_000 }).toBeDefined();
      return found()!;
    },
    page,
    async click(target) {
      const box = (await target.boundingBox())!;
      const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await mouse("mouseMoved", at, 0);
      await mouse("mousePressed", at, 1);
      await mouse("mouseReleased", at, 0);
    },
    letGo: () => runtime.dispose(),
  };
}

const BUTTONS = `
  <h1>Orders</h1>
  <button id="first">First</button>
  <button id="second">Second</button>
  <button id="third">Third</button>`;

/** Playwright reports Interactions from now on. */
async function reporting(browser: Harness) {
  await browser.ask({ kind: "reportInteractions", on: true });
  await browser.toldOf("reportingInteractions");
}

it("starts Playwright's recorder, which reports a person's click with its target in its own snapshot", async () => {
  const browser = await onStockPlaywright(BUTTONS);
  await reporting(browser);

  await browser.click(browser.page.locator("#second"));

  const { report } = await browser.toldOf("interactionReported");
  expect(report).toMatchObject({
    type: "click",
    selector: expect.stringContaining("Second"),
    target: {
      ref: expect.stringMatching(/^e\d+$/),
      tree: expect.stringContaining(`button "Second"`),
    },
    values: { button: "left", modifiers: 0, clickCount: 1 },
  });
  // The ref names the clicked button in the report's own snapshot.
  expect(report.target!.tree).toMatch(
    new RegExp(`button "Second"[^\\n]*\\[ref=${report.target!.ref}\\]`)
  );
});

it("reports the person's inputs in the order they were given", async () => {
  const browser = await onStockPlaywright(BUTTONS);
  await reporting(browser);

  for (const name of ["third", "first", "second", "first"])
    await browser.click(browser.page.locator(`#${name}`));

  await expect
    .poll(
      () =>
        browser.told
          .filter((signal) => signal.kind === "interactionReported")
          .map(({ report }) => report.selector),
      { timeout: 10_000 }
    )
    .toEqual([
      expect.stringContaining("Third"),
      expect.stringContaining("First"),
      expect.stringContaining("Second"),
      expect.stringContaining("First"),
    ]);
});

it("gives each report a snapshot of the shape a public snapshot has", async () => {
  const browser = await onStockPlaywright(BUTTONS);
  await reporting(browser);
  await browser.ask({ kind: "takeSnapshot", snapshot: "s1", page: "page_1" });
  const { snapshot } = await browser.toldOf("snapshotTaken");

  await browser.click(browser.page.locator("#third"));

  const { report } = await browser.toldOf("interactionReported");
  // Refs are each snapshot's own, and so are marks of what has focus now.
  const shape = (tree: string) => tree.replaceAll(/ \[(ref=\w+|active)\]/g, "");
  expect(shape(report.target!.tree)).toBe(shape(snapshot.tree));
});

it("hides what Playwright's recorder draws over the page", async () => {
  const browser = await onStockPlaywright(BUTTONS);
  await reporting(browser);

  const overlay = browser.page.locator("x-pw-glass");
  await expect.poll(() => overlay.count(), { timeout: 10_000 }).toBe(1);
  expect(
    await overlay.evaluate((element) => getComputedStyle(element).display)
  ).toBe("none");
});

it("reports a click the page held back once, after it is passed on", async () => {
  const browser = await onStockPlaywright(BUTTONS);
  await reporting(browser);
  await browser.ask({ kind: "holdInputs", on: true });
  await browser.toldOf("inputsHeld");

  await browser.click(browser.page.locator("#first"));
  const { input } = await browser.toldOf("inputHeld");
  // Playwright's recorder has not seen it yet.
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  expect(browser.told.map(({ kind }) => kind)).not.toContain(
    "interactionReported"
  );

  await browser.ask({ kind: "passOn", input });

  await browser.toldOf("interactionReported");
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  expect(
    browser.told
      .filter((signal) => signal.kind === "interactionReported")
      .map(({ report }) => report.selector)
  ).toEqual([expect.stringContaining("First")]);
});

it("switches Playwright's recorder off and on again by its mode", async () => {
  const browser = await onStockPlaywright(BUTTONS);
  await reporting(browser);
  const reported = () =>
    browser.told
      .filter((signal) => signal.kind === "interactionReported")
      .map(({ report }) => report.selector);

  await browser.ask({ kind: "reportInteractions", on: false });
  await browser.toldOf("reportingInteractions", ({ on }) => !on);
  await browser.click(browser.page.locator("#first"));
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  expect(reported()).toEqual([]);

  await browser.ask({ kind: "reportInteractions", on: true });
  await expect
    .poll(
      () =>
        browser.told.filter(
          (signal) => signal.kind === "reportingInteractions" && signal.on
        ).length
    )
    .toBe(2);
  await browser.click(browser.page.locator("#second"));
  await expect
    .poll(reported, { timeout: 10_000 })
    .toEqual([expect.stringContaining("Second")]);
});

// Visits.

it("starts a document the page goes to with the gate as it was last set", async () => {
  const browser = await onStockPlaywright(BUTTONS);
  await reporting(browser);
  await browser.ask({ kind: "holdInputs", on: true });
  await browser.toldOf("inputsHeld");

  await browser.page.goto(`${browser.page.url()}?next`);
  await browser.click(browser.page.locator("#first"));

  await browser.toldOf("inputHeld");
});

it("tells of a held click whose document is gone, and never sends it to the next", async () => {
  const browser = await onStockPlaywright(BUTTONS);
  await reporting(browser);
  await browser.ask({ kind: "holdInputs", on: true });
  await browser.toldOf("inputsHeld");
  await browser.click(browser.page.locator("#first"));
  const { input } = await browser.toldOf("inputHeld");

  await browser.page.goto(`${browser.page.url()}?next`);
  await browser.page.evaluate(() => {
    (window as unknown as { clicks: number }).clicks = 0;
    document.addEventListener(
      "click",
      () => ((window as unknown as { clicks: number }).clicks += 1),
      true
    );
  });
  await browser.ask({ kind: "passOn", input });

  await browser.toldOf("inputGone", (gone) => gone.input === input);
  expect(browser.told.map(({ kind }) => kind)).not.toContain("inputPassedOn");
  expect(await browser.page.evaluate("window.clicks")).toBe(0);
});

// Attaching.

it.runIf(attaching)(
  "lets go of a browser it attached to as it found it: open, its page where it was, and Playwright's recorder no longer acting on it",
  async () => {
    const browser = await onStockPlaywright(`${BUTTONS}
      <script>
        window.events = [];
        for (const type of ["mousedown", "contextmenu", "click"])
          document.addEventListener(type, (event) =>
            window.events.push(type + " " + event.button));
      </script>`);
    await reporting(browser);
    await browser.ask({ kind: "holdInputs", on: true });
    await browser.toldOf("inputsHeld");
    const url = browser.page.url();

    await browser.letGo();

    expect(browser.page.isClosed()).toBe(false);
    expect(browser.page.url()).toBe(url);
    // A right click and a left click reach the page, each once: nothing
    // holds them back or takes them any more.
    await browser.page.locator("#first").click({ button: "right" });
    await browser.page.locator("#first").click();
    await expect
      .poll(() => browser.page.evaluate("window.events"))
      .toEqual(["mousedown 2", "contextmenu 2", "mousedown 0", "click 0"]);
    // Playwright's recorder leaves no mark that makes every element look
    // clickable.
    expect(
      await browser.page.evaluate(() =>
        document.body.getAttribute("data-pw-cursor")
      )
    ).toBeNull();
  }
);

it.runIf(attaching)(
  "reports a click another automation client gives in the browser, held back and passed on like a person's",
  async () => {
    const browser = await onStockPlaywright(BUTTONS);
    await reporting(browser);
    await browser.ask({ kind: "holdInputs", on: true });
    await browser.toldOf("inputsHeld");

    // The browser's own client clicks through its Playwright API.
    await browser.page.locator("#second").click();

    const { input } = await browser.toldOf("inputHeld");
    await browser.ask({ kind: "passOn", input });
    const { report } = await browser.toldOf("interactionReported");
    expect(report).toMatchObject({
      type: "click",
      selector: expect.stringContaining("Second"),
      target: { tree: expect.stringContaining(`button "Second"`) },
    });
  }
);

it.runIf(attaching)(
  "names a click's target by a ref of the recorder's own connection, not of another client's",
  async () => {
    const browser = await onStockPlaywright(BUTTONS);
    // The other client reads the page, the page changes, and it reads it
    // again: its refs are numbered on its own connection.
    await browser.page.ariaSnapshot({ mode: "ai" });
    await browser.page.evaluate(() =>
      document.body.insertAdjacentHTML(
        "afterbegin",
        `<button id="zero">Zero</button>`
      )
    );
    const theirs = await browser.page.ariaSnapshot({ mode: "ai" });
    const theirRef = /button "Zero" \[ref=(\w+)\]/.exec(theirs)![1]!;
    await reporting(browser);

    await browser.click(browser.page.locator("#zero"));

    const { report } = await browser.toldOf("interactionReported");
    const ours = report.target!.ref;
    expect(report.target!.tree).toMatch(
      new RegExp(`button "Zero"[^\\n]*\\[ref=${ours}\\]`)
    );
    // The same element has another ref on the other connection, and the
    // recorder's ref names another element there.
    expect(ours).not.toBe(theirRef);
    expect(
      await browser.page
        .locator(`aria-ref=${ours}`)
        .evaluate((element) => element.id)
        .catch(() => "none")
    ).not.toBe("zero");
  }
);

it.runIf(attaching)(
  "does not attach to a browser with more than one page open, and leaves its pages as they are",
  async () => {
    const debugPort = await freePort();
    const running = await chromium.launchPersistentContext("", {
      headless: true,
      args: [`--remote-debugging-port=${debugPort}`],
    });
    ends.push(() => running.close());
    await running.newPage();
    const runtime = ManagedRuntime.make(
      stockBrowser({ projectDir, cdpEndpoint: `http://127.0.0.1:${debugPort}` })
    );
    ends.push(() => runtime.dispose());

    const failure = await runtime
      .runPromise(RecordedBrowser)
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({
      reason: "browser-unavailable",
      message: expect.stringContaining(
        "The browser at this address has 2 pages in 1 context"
      ),
    });
    expect(running.pages()).toHaveLength(2);
  }
);
