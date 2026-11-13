import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as createNetServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
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
import {
  loadProjectPlaywright,
  projectPlaywrightCli,
} from "./projectPlaywright";
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

/** The Chromium of the Playwright under test, which starts the running
 * browser an attaching recorder finds: each version needs only the browser
 * build it installs. The test's own connections use this package's
 * Playwright, which needs no browser to connect. */
const underTest = await Effect.runPromise(loadProjectPlaywright(projectDir));
const { chromium: projectChromium } = underTest.playwright;

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
    running = await projectChromium.launchPersistentContext("", {
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

// The trace (ticket #1274): one trace for a recording, a mark for each
// snapshot, and the stock trace tool's own number for each mark. The tool is
// run as a reader runs it, on the project's own Playwright; it names the flag
// that picks the phase of a snapshot differently on 1.62 than from 1.63.

/** What `expression` gives on the page the stock trace tool opens at
 * `position` of the trace in `file`, in the "after" phase. */
async function stockToolEvaluates(
  file: string,
  position: string,
  expression: string
) {
  const cli = projectPlaywrightCli(projectDir)!;
  const { version } = JSON.parse(
    await readFile(join(dirname(cli), "package.json"), "utf8")
  ) as { version: string };
  const [major, minor] = version.split(".").map(Number);
  const phase = major === 1 && minor! <= 62 ? "--name" : "--phase";
  // The tool keeps what it has opened in the folder it runs in.
  const cwd = await mkdtemp(join(tmpdir(), "ayme-recorder-contract-"));
  const tool = (...args: string[]) =>
    promisify(execFile)(process.execPath, [cli, "trace", ...args], {
      cwd,
      maxBuffer: 1 << 26,
    }).then(({ stdout }) => stdout);
  try {
    await tool("open", file);
    const output = await tool(
      "snapshot",
      position,
      phase,
      "after",
      "eval",
      expression
    );
    return JSON.parse(/### Result\n(.*)\n/.exec(output)![1]!) as unknown;
  } finally {
    await tool("close").catch(() => {});
    await rm(cwd, { recursive: true, force: true });
  }
}

it("traces the recording, marks each snapshot, and numbers each mark as the stock trace tool does", async () => {
  const browser = await onStockPlaywright(BUTTONS);
  await browser.ask({ kind: "startTrace" });
  // The engine asks for a snapshot once the trace is told started.
  await browser.toldOf("traceStarted");

  await browser.page.evaluate(() => {
    document.querySelector("h1")!.textContent = "One";
  });
  await browser.ask({
    kind: "takeSnapshot",
    snapshot: "snapshot_1",
    page: "page_1",
  });
  await browser.toldOf(
    "snapshotTaken",
    ({ snapshot }) => snapshot.id === "snapshot_1"
  );
  await browser.page.evaluate(() => {
    document.querySelector("h1")!.textContent = "Two";
  });
  await browser.ask({
    kind: "takeSnapshot",
    snapshot: "snapshot_2",
    page: "page_1",
  });
  await browser.toldOf(
    "snapshotTaken",
    ({ snapshot }) => snapshot.id === "snapshot_2"
  );
  await browser.ask({ kind: "stopTrace", keep: true });
  const { trace } = await browser.toldOf("traceStopped");

  expect(Object.keys(trace.positions).sort()).toEqual([
    "snapshot_1",
    "snapshot_2",
  ]);
  const title = "document.querySelector('h1').textContent";
  expect(
    await stockToolEvaluates(trace.file, trace.positions.snapshot_1!, title)
  ).toBe("One");
  expect(
    await stockToolEvaluates(trace.file, trace.positions.snapshot_2!, title)
  ).toBe("Two");
  await rm(dirname(trace.file), { recursive: true, force: true });
});

it("tells of a trace that is kept, and of none that is thrown away, and starts a new one after it", async () => {
  const browser = await onStockPlaywright(BUTTONS);
  await browser.ask({ kind: "startTrace" });
  await browser.toldOf("traceStarted");
  // Each request is asked when the last is told: the adapter orders none.
  await browser.ask({ kind: "stopTrace", keep: false });
  await browser.toldOf("traceDiscarded");
  await browser.ask({ kind: "startTrace" });
  await expect
    .poll(
      () => browser.told.filter((signal) => signal.kind === "traceStarted"),
      { timeout: 10_000 }
    )
    .toHaveLength(2);
  await browser.ask({
    kind: "takeSnapshot",
    snapshot: "snapshot_1",
    page: "page_1",
  });
  // The engine stops the trace once its snapshots are in.
  await browser.toldOf("snapshotTaken");

  await browser.ask({ kind: "stopTrace", keep: true });

  const { trace } = await browser.toldOf("traceStopped");
  expect(Object.keys(trace.positions)).toEqual(["snapshot_1"]);
  expect(
    browser.told.filter((signal) => signal.kind === "traceStopped")
  ).toHaveLength(1);
  expect(
    browser.told.filter((signal) => signal.kind === "requestFailed")
  ).toEqual([]);
  await rm(dirname(trace.file), { recursive: true, force: true });
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
    const running = await projectChromium.launchPersistentContext("", {
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
        "The browser at this address has 2 pages open"
      ),
    });
    expect(running.pages()).toHaveLength(2);
  }
);

it.runIf(attaching)(
  "attaches to a browser whose one page sits beside an empty context, as a browser a Playwright test started has",
  async () => {
    const debugPort = await freePort();
    // A launched browser keeps a default context with no page; the test's
    // page is in a context of its own.
    const running = await projectChromium.launch({
      headless: true,
      args: [`--remote-debugging-port=${debugPort}`],
    });
    ends.push(() => running.close());
    const page = await (await running.newContext()).newPage();
    await page.setContent("<button>Only</button>");
    const runtime = ManagedRuntime.make(
      stockBrowser({ projectDir, cdpEndpoint: `http://127.0.0.1:${debugPort}` })
    );
    ends.push(() => runtime.dispose());

    const browser = await runtime.runPromise(RecordedBrowser);
    const told = await runtime.runPromise(Queue.clear(browser.signals));

    expect(told).toContainEqual(
      expect.objectContaining({ kind: "pageOpened" })
    );
  }
);

it.runIf(attaching)(
  "does not attach to a browser with no page open, and says what it found",
  async () => {
    const debugPort = await freePort();
    const running = await projectChromium.launch({
      headless: true,
      args: [`--remote-debugging-port=${debugPort}`],
    });
    ends.push(() => running.close());
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
        "The browser at this address has no page open"
      ),
    });
  }
);

// Follow-ups to every kind of input.
it("reports files chosen in a file input as an upload, with their names", async () => {
  const browser = await onStockPlaywright(
    `<label>Photos <input id="photos" type="file" multiple /></label>`
  );
  await reporting(browser);

  // Chosen by another client of the browser, as a person's choice would be.
  await browser.page.locator("#photos").setInputFiles([
    { name: "one.png", mimeType: "image/png", buffer: Buffer.from("1") },
    { name: "two.png", mimeType: "image/png", buffer: Buffer.from("2") },
  ]);

  const { report } = await browser.toldOf("interactionReported");
  expect(report).toMatchObject({
    type: "setInputFiles",
    selector: expect.stringContaining("Photos"),
    values: { files: ["one.png", "two.png"] },
  });
  expect(report.values).not.toHaveProperty("text");
});

it("warns, and keeps the first name, when the file input of an upload cannot be read any more", async () => {
  // The page takes the input away as soon as files are chosen in it.
  const browser = await onStockPlaywright(
    `<label>Photos <input id="photos" type="file" multiple oninput="this.remove()" /></label>`
  );
  await reporting(browser);

  await browser.page.locator("#photos").setInputFiles([
    { name: "one.png", mimeType: "image/png", buffer: Buffer.from("1") },
    { name: "two.png", mimeType: "image/png", buffer: Buffer.from("2") },
  ]);

  const { warning } = await browser.toldOf("browserWarned");
  expect(warning).toEqual({
    kind: "uploadNamesUnknown",
    message: expect.stringContaining(
      "could not all be read: the upload is recorded with the first, one.png."
    ),
  });
  const { report } = await browser.toldOf("interactionReported");
  expect(report).toMatchObject({
    type: "setInputFiles",
    values: { files: ["one.png"] },
  });
  // The warning comes before the report it is about.
  expect(
    browser.told.findIndex((signal) => signal.kind === "browserWarned")
  ).toBeLessThan(
    browser.told.findIndex((signal) => signal.kind === "interactionReported")
  );
});

// Assert visibility (ticket #1278): Playwright's own picking mode, switched
// and heard through private parts of Playwright.

const CLICKABLE = `
  <h1>Orders</h1>
  <button id="first" onclick="window.clicks = (window.clicks ?? 0) + 1">First</button>
  <div id="card" style="cursor: pointer" onclick="window.clicks = (window.clicks ?? 0) + 1">
    <span>Open the card</span>
    <p>Details</p>
  </div>
  <p>Plain text</p>
  <a href="#more">More</a>`;

it("switches Playwright's recorder into its picking mode and out of it, and tells of each change of its mode", async () => {
  const browser = await onStockPlaywright(BUTTONS);
  await reporting(browser);

  await browser.ask({ kind: "pick", on: true });
  await browser.toldOf("picking", ({ on }) => on);

  await browser.ask({ kind: "pick", on: false });
  await browser.toldOf("picking", ({ on }) => !on);
  expect(
    browser.told
      .filter((signal) => signal.kind === "picking")
      .map((signal) => signal.on)
  ).toEqual([true, false]);
});

it("reports the element a person picks as an assertion, leaves picking by itself, and the click reaches neither the page nor the gate", async () => {
  const browser = await onStockPlaywright(CLICKABLE);
  await reporting(browser);
  await browser.ask({ kind: "holdInputs", on: true });
  await browser.toldOf("inputsHeld");
  await browser.ask({ kind: "pick", on: true });
  await browser.toldOf("picking", ({ on }) => on);

  await browser.click(browser.page.locator("#first"));

  const { report } = await browser.toldOf("interactionReported");
  expect(report).toMatchObject({
    type: "assertVisible",
    selector: expect.stringContaining("First"),
  });
  await browser.toldOf("picking", ({ on }) => !on);
  expect(browser.told.map(({ kind }) => kind)).not.toContain("inputHeld");
  expect(await browser.page.evaluate("window.clicks ?? 0")).toBe(0);
});

it("leaves the gate holding clicks again once picking is over", async () => {
  const browser = await onStockPlaywright(CLICKABLE);
  await reporting(browser);
  await browser.ask({ kind: "holdInputs", on: true });
  await browser.toldOf("inputsHeld");
  await browser.ask({ kind: "pick", on: true });
  await browser.toldOf("picking", ({ on }) => on);
  await browser.click(browser.page.locator("#first"));
  await browser.toldOf("picking", ({ on }) => !on);
  await browser.ask({ kind: "pick", on: false });

  await browser.click(browser.page.locator("#first"));

  await browser.toldOf("inputHeld");
});

it("marks the same elements as clickable in a snapshot before, during and after an assertion", async () => {
  const browser = await onStockPlaywright(CLICKABLE);
  await reporting(browser);
  /** The lines of a snapshot that mark an element as clickable, without
   * refs, which are each snapshot's own. */
  const clickable = async (snapshot: string) => {
    await browser.ask({ kind: "takeSnapshot", snapshot, page: "page_1" });
    const { snapshot: taken } = await browser.toldOf(
      "snapshotTaken",
      (told) => told.snapshot.id === snapshot
    );
    return taken.tree
      .split("\n")
      .filter((line) => line.includes("[cursor=pointer]"))
      .map((line) => line.replaceAll(/ \[(ref=\w+|active)\]/g, ""));
  };
  const before = await clickable("before");
  // The card and the link, and nothing in the card.
  expect(before).toEqual([
    expect.stringMatching(/^ {2}- generic /),
    expect.stringContaining(`link "More"`),
  ]);

  await browser.ask({ kind: "pick", on: true });
  await browser.toldOf("picking", ({ on }) => on);
  expect(await clickable("during")).toEqual(before);

  await browser.click(browser.page.locator("#first"));
  await browser.toldOf("picking", ({ on }) => !on);
  expect(await clickable("after")).toEqual(before);
});

// The hover highlight (ticket #1278): the recorder's own highlight, drawn
// on the element a ref of the adapter's own latest snapshot names.

const PLACES = `
  <h1>Orders</h1>
  <button id="main">Main</button>
  <iframe style="margin-left: 40px; height: 80px" srcdoc="<button>In frame</button>"></iframe>
  <shadow-place></shadow-place>
  <script>
    customElements.define("shadow-place", class extends HTMLElement {
      constructor() {
        super();
        this.attachShadow({ mode: "open" }).innerHTML =
          "<button style='margin-left: 80px'>In shadow</button>";
      }
    });
  </script>`;

/** The highlight drawn on the page now, in the page's coordinates; null
 * when none is. */
const drawn = (page: Page) =>
  page.evaluate(() => {
    const host = document.querySelector("ayme-recorder-highlight");
    if (!host) return null;
    const { x, y, width, height } = host.getBoundingClientRect();
    return { x, y, width, height };
  });

/** Takes a snapshot, and gives the ref it names a button by. */
async function refOf(browser: Harness, snapshot: string, name: string) {
  await browser.ask({ kind: "takeSnapshot", snapshot, page: "page_1" });
  const { snapshot: taken } = await browser.toldOf(
    "snapshotTaken",
    (told) => told.snapshot.id === snapshot
  );
  const ref = new RegExp(`button "${name}" \\[ref=(\\w+)\\]`).exec(
    taken.tree
  )?.[1];
  if (!ref) throw new Error(`No button "${name}" in:\n${taken.tree}`);
  return { ref, tree: taken.tree };
}

it("draws the highlight on the element a ref names, in the page, in a same-origin frame and in an open shadow root, and clears it", async () => {
  const browser = await onStockPlaywright(PLACES);
  const inFrame = browser.page.frameLocator("iframe").getByRole("button");
  await inFrame.waitFor();
  const elements: [string, Locator][] = [
    ["Main", browser.page.locator("#main")],
    ["In frame", inFrame],
    ["In shadow", browser.page.getByRole("button", { name: "In shadow" })],
  ];

  for (const [index, [name, element]] of elements.entries()) {
    const { ref } = await refOf(browser, `snapshot_${index + 1}`, name);
    await browser.ask({
      kind: "highlight",
      highlight: index + 1,
      target: { page: "page_1", ref, selector: null },
    });

    const { found } = await browser.toldOf(
      "highlighted",
      (told) => told.highlight === index + 1
    );
    expect(found).toBe(true);
    const box = (await element.boundingBox())!;
    await expect
      .poll(() => drawn(browser.page))
      .toEqual({
        x: expect.closeTo(box.x, 0),
        y: expect.closeTo(box.y, 0),
        width: expect.closeTo(box.width, 0),
        height: expect.closeTo(box.height, 0),
      });
  }

  await browser.ask({ kind: "highlight", highlight: 4, target: null });
  await expect.poll(() => drawn(browser.page)).toBeNull();
});

it("draws nothing for a highlight that a clear replaced while the element was still looked up", async () => {
  const browser = await onStockPlaywright(PLACES);
  const { ref } = await refOf(browser, "snapshot_1", "Main");

  // The clear is asked while the element of the first is looked up.
  await Promise.all([
    browser.ask({
      kind: "highlight",
      highlight: 1,
      target: { page: "page_1", ref, selector: null },
    }),
    browser.ask({ kind: "highlight", highlight: 2, target: null }),
  ]);

  const { found } = await browser.toldOf("highlighted");
  expect(found).toBe(false);
  expect(await drawn(browser.page)).toBeNull();
});

it("draws nothing, and says so, for an element the page no longer has", async () => {
  const browser = await onStockPlaywright(PLACES);
  const { ref } = await refOf(browser, "snapshot_1", "Main");
  await browser.page.evaluate(() => document.querySelector("#main")!.remove());

  await browser.ask({
    kind: "highlight",
    highlight: 1,
    target: { page: "page_1", ref, selector: null },
  });

  const { found } = await browser.toldOf("highlighted");
  expect(found).toBe(false);
  expect(await drawn(browser.page)).toBeNull();
});

it("keeps the highlight out of the page's structure and out of the trace's numbering of snapshots", async () => {
  const browser = await onStockPlaywright(PLACES);
  await browser.ask({ kind: "startTrace" });
  await browser.toldOf("traceStarted");
  await browser.page.evaluate(() => {
    document.querySelector("h1")!.textContent = "One";
  });
  const { ref, tree } = await refOf(browser, "snapshot_1", "Main");
  await browser.ask({
    kind: "highlight",
    highlight: 1,
    target: { page: "page_1", ref, selector: null },
  });
  await browser.toldOf("highlighted");
  await expect.poll(() => drawn(browser.page)).not.toBeNull();

  const { tree: highlightedTree } = await refOf(browser, "snapshot_2", "Main");
  await browser.page.evaluate(() => {
    document.querySelector("h1")!.textContent = "Two";
  });
  await refOf(browser, "snapshot_3", "Main");
  await browser.ask({ kind: "stopTrace", keep: true });
  const { trace } = await browser.toldOf("traceStopped");

  expect(highlightedTree).toBe(tree);
  const title = "document.querySelector('h1').textContent";
  expect(
    await stockToolEvaluates(trace.file, trace.positions.snapshot_1!, title)
  ).toBe("One");
  expect(
    await stockToolEvaluates(trace.file, trace.positions.snapshot_3!, title)
  ).toBe("Two");
  await rm(dirname(trace.file), { recursive: true, force: true });
});

it.runIf(attaching)(
  "leaves no highlight behind when it lets go of a browser it attached to",
  async () => {
    const browser = await onStockPlaywright(PLACES);
    const { ref } = await refOf(browser, "snapshot_1", "Main");
    await browser.ask({
      kind: "highlight",
      highlight: 1,
      target: { page: "page_1", ref, selector: null },
    });
    await browser.toldOf("highlighted");
    await expect.poll(() => drawn(browser.page)).not.toBeNull();

    await browser.letGo();

    expect(await drawn(browser.page)).toBeNull();
  }
);

// Private details found in review.
it("names a click on an element its snapshot does not list by the nearest ancestor it does, with the element's own selector", async () => {
  // A decoration with no role, in a group that has one.
  const browser = await onStockPlaywright(
    `<div role="group" aria-label="Card"><i id="star" style="display:inline-block;width:24px;height:24px;background:gold"></i></div>`
  );
  await reporting(browser);

  await browser.click(browser.page.locator("#star"));

  const { report } = await browser.toldOf("interactionReported");
  expect(report.target).toMatchObject({ ref: null });
  const [nearest] = report.target!.ancestors ?? [];
  // The ancestor's ref is the group's in the report's own snapshot.
  expect(report.target!.tree).toMatch(
    new RegExp(`group "Card"[^\\n]*\\[ref=${nearest}\\]`)
  );
  // The selector is the element's own.
  expect(
    await browser.page
      .locator(report.selector!)
      .evaluate((element) => element.id)
  ).toBe("star");
});

/**
 * What the Playwright under test does with a left click it may hold back
 * to see whether a double click follows, when its recorder is switched off
 * right after it:
 * - flushes: 1.64 and later hold it back, and report it when asked to;
 * - reportsAtOnce: 1.62 holds nothing back;
 * - holdsBack: 1.63 holds it back and cannot be asked to report it, so the
 *   click can be lost (the documented limit).
 */
const clickHeldBack = (() => {
  const [major = 0, minor = 0] = underTest.version.split(".").map(Number);
  if (major > 1 || minor >= 64) return "flushes";
  return minor <= 62 ? "reportsAtOnce" : "holdsBack";
})();

it(`reports a click made just before Playwright's recorder is switched off ${clickHeldBack === "holdsBack" ? "only after the switch-off is answered, if at all" : "before the switch-off is answered"} (Playwright ${underTest.version}: ${clickHeldBack})`, async () => {
  const browser = await onStockPlaywright(BUTTONS);
  await reporting(browser);

  await browser.click(browser.page.locator("#second"));
  await browser.ask({ kind: "reportInteractions", on: false });
  await browser.toldOf("reportingInteractions", (signal) => !signal.on);
  // Longer than Playwright holds a click back.
  await new Promise((resolve) => setTimeout(resolve, 1_000));

  const reported = browser.told.findIndex(
    (signal) => signal.kind === "interactionReported"
  );
  const answered = browser.told.findIndex(
    (signal) => signal.kind === "reportingInteractions" && !signal.on
  );
  if (clickHeldBack === "holdsBack")
    expect(reported === -1 || reported > answered).toBe(true);
  else {
    expect(reported).toBeGreaterThanOrEqual(0);
    expect(reported).toBeLessThan(answered);
  }
});

it("reports typing once, and revises that report with each key typed into the same field", async () => {
  const browser = await onStockPlaywright(
    `<label>Item <input id="item" /></label>`
  );
  await reporting(browser);
  await browser.page.locator("#item").focus();

  // Keys given over the test's own connection, as a person's are.
  await browser.page.keyboard.type("abc");

  await browser.toldOf(
    "interactionRevised",
    (signal) => signal.report.values["text"] === "abc"
  );
  const typing = browser.told.filter(
    (signal) =>
      signal.kind === "interactionReported" ||
      signal.kind === "interactionRevised"
  );
  expect(
    typing.map((signal) => [
      signal.kind,
      "report" in signal ? signal.report.type : null,
      "report" in signal ? signal.report.values["text"] : null,
    ])
  ).toEqual([
    ["interactionReported", "fill", "a"],
    ["interactionRevised", "fill", "ab"],
    ["interactionRevised", "fill", "abc"],
  ]);
});

// The review of the whole recorder against the spec.
it("holds a click behind an input that still waits to be passed on, also once the pages no longer hold inputs back: input reaches the page in the order it was given", async () => {
  const browser = await onStockPlaywright(`${BUTTONS}
    <script>
      window.clicks = [];
      document.addEventListener("click", (event) =>
        window.clicks.push(event.target.id));
    </script>`);
  const clicks = () => browser.page.evaluate("window.clicks");
  await reporting(browser);
  await browser.ask({ kind: "holdInputs", on: true });
  await browser.toldOf("inputsHeld");
  await browser.click(browser.page.locator("#first"));
  const first = await browser.toldOf("inputHeld");

  // The pages stop holding inputs back while the first click still waits.
  await browser.ask({ kind: "holdInputs", on: false });
  await browser.toldOf("inputsHeld", (signal) => !signal.on);
  await browser.click(browser.page.locator("#second"));

  // The second click is held behind the first: neither has reached the page.
  const second = await browser.toldOf(
    "inputHeld",
    (signal) => signal.input !== first.input
  );
  expect(await clicks()).toEqual([]);
  await browser.ask({ kind: "passOn", input: first.input });
  await browser.toldOf("inputPassedOn", ({ input }) => input === first.input);
  await browser.ask({ kind: "passOn", input: second.input });
  await browser.toldOf("inputPassedOn", ({ input }) => input === second.input);
  await expect.poll(clicks).toEqual(["first", "second"]);

  // Nothing waits any more: the next click is the page's own.
  await browser.click(browser.page.locator("#third"));
  await expect.poll(clicks).toEqual(["first", "second", "third"]);
  expect(
    browser.told.filter((signal) => signal.kind === "inputHeld")
  ).toHaveLength(2);
});
