import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as createNetServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  isSyntheticRef,
  StructuralTree,
  SyntheticAriaRefFactory,
} from "@ayme-dev/core/structural-observation";
import { Effect, ManagedRuntime, Queue } from "effect";
import {
  chromium,
  type BrowserContext,
  type Locator,
  type Page,
} from "playwright-core";
import { afterEach, expect, it } from "vitest";

import { RecordedBrowser } from "../../../session/application";
import type {
  BrowserRequest,
  BrowserSignal,
  Written,
} from "../../../session/domain";
import {
  labelOf,
  snapshotRef,
  Timeline,
  type ElementLookup,
} from "../../../timeline/domain";
import {
  loadProjectPlaywright,
  projectPlaywrightCli,
} from "../projectPlaywright";
import { startGate } from "../in-page/gate";
import { installGate, startPickingIn } from "./pageFunctions";
import { stockBrowser } from "./stockBrowser";
import { snapshotId } from "../../../../testing/ids";
import { zipText } from "../../../../testing/zip";

// The compatibility suite: the stock adapter on each supported Playwright.
// Each private detail of Playwright the adapter uses has its test here
// (ADR-0052), and every test speaks only the recorded browser's seam:
// requests asked, signals told. CI runs this file once per supported
// Playwright version, and the weekly canary against the newest one.
//
// The Playwright under test is the one installed in the project folder that
// AYME_RECORDER_PLAYWRIGHT_PROJECT names, or else this package's own. To add
// a private detail, add one test that uses `onStockPlaywright`.
//
// The suite runs twice (vitest.compat.config.ts): on a browser the adapter
// launches, and, with AYME_RECORDER_BROWSER=attach, on a browser that is
// already running, with its page open, when the adapter attaches to it. That
// browser is the test's own: it launched it, and its connection is another
// automation client in the recorded browser.
const attaching = process.env.AYME_RECORDER_BROWSER === "attach";

const projectDir =
  process.env.AYME_RECORDER_PLAYWRIGHT_PROJECT ??
  fileURLToPath(new URL("../../../..", import.meta.url));

/** The Chromium of the Playwright under test, which starts the running
 * browser an attaching recorder finds: each version needs only the browser
 * build it installs. The test's own connections use this package's
 * Playwright, which needs no browser to connect. */
const underTest = await Effect.runPromise(loadProjectPlaywright(projectDir));
const { chromium: projectChromium } = underTest.playwright;

/** A recorded browser on stock Playwright, as the engine sees it. */
type Harness = {
  /** Takes the ids a test writes by hand, as the browser's requests carry
   * them. */
  ask(request: Written<BrowserRequest>): Promise<void>;
  /** Everything told so far, in order. */
  readonly told: readonly BrowserSignal[];
  /** Resolves with the first signal told that matches. */
  toldOf<K extends BrowserSignal["kind"]>(
    kind: K,
    matches?: (signal: Extract<BrowserSignal, { kind: K }>) => boolean
  ): Promise<Extract<BrowserSignal, { kind: K }>>;
  /** The recorded page, over the test's own connection to the browser. */
  readonly page: Page;
  /** The address of the served page. */
  readonly url: string;
  /** A person at the recorded browser: raw input over that connection, so
   * that it is no call of the Playwright under test. A count of 2 is the
   * second click of a double click. */
  click(
    target: Locator,
    button?: "left" | "right" | "middle",
    count?: number
  ): Promise<void>;
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

/** Serves one page of HTML, and opens the recorded browser on it, or, to
 * start recording, on a blank page that goes there once Record holds
 * inputs back. `storage` gives the storage state files of a launch, once
 * the page's address is known. */
async function onStockPlaywright(
  html: string,
  {
    startRecording = false,
    storage,
  }: {
    startRecording?: boolean;
    storage?: (
      url: string
    ) => Promise<{ loadStorage?: string; saveStorage?: string }>;
  } = {}
): Promise<Harness> {
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
  const storageFiles = storage ? await storage(url) : {};

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
      : stockBrowser({
          projectDir,
          url,
          headless: true,
          debugPort,
          ...(startRecording ? { startRecording } : {}),
          ...storageFiles,
        })
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
  const opensAt = startRecording ? "about:blank" : url;
  const page = contexts
    .flatMap((context) => context.pages())
    .find((candidate) => candidate.url() === opensAt);
  if (!page) throw new Error(`No page at ${url} in the recorded browser.`);
  const session = await page.context().newCDPSession(page);
  const mouse = (
    type: string,
    at: { x: number; y: number },
    buttons: number,
    button: "left" | "right" | "middle" = "left",
    clickCount = 1
  ) =>
    session.send("Input.dispatchMouseEvent", {
      type: type as "mouseMoved",
      x: at.x,
      y: at.y,
      button: type === "mouseMoved" ? "none" : button,
      buttons,
      clickCount,
      pointerType: "mouse",
    });

  return {
    ask: (request) =>
      runtime.runPromise(browser.ask(request as BrowserRequest)),
    told,
    url,
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
    async click(target, button = "left", count = 1) {
      const box = (await target.boundingBox())!;
      const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await mouse("mouseMoved", at, 0);
      const pressed = { left: 1, right: 2, middle: 4 }[button];
      await mouse("mousePressed", at, pressed, button, count);
      await mouse("mouseReleased", at, 0, button, count);
    },
    letGo: () => runtime.dispose(),
  };
}

const BUTTONS = `
  <h1>Orders</h1>
  <button id="first">First</button>
  <button id="second">Second</button>
  <button id="third">Third</button>`;

async function reporting(browser: Harness) {
  await browser.ask({ kind: "reportInteractions", on: true });
  await browser.toldOf("reportingInteractions");
}

/** The line of a report's picture that names its target. */
const namedLine = ({
  target,
}: Extract<BrowserSignal, { kind: "interactionReported" }>["report"]) => {
  const ref = target!.ref ?? target!.ancestors?.[0];
  return target!.tree.split("\n").find((line) => line.includes(`[ref=${ref}]`));
};

/** Whether the Playwright under test holds a left click's report back, to
 * see whether a double click follows (1.63 and later): the page's note of
 * the click then comes before the report. 1.62 reports a click at once,
 * before the page's note of it, and a double click as a revision of its
 * first click's report. */
const holdsClickReports = (() => {
  const [major = 0, minor = 0] = underTest.version.split(".").map(Number);
  return major > 1 || minor >= 63;
})();

/** A link that a click removes when `condition` holds, where Playwright
 * holds the click's report back: its selector then matches nothing by the
 * time the report could be read through it, so only the page's note of the
 * click names the link. On 1.62, whose report comes before the note, the
 * link stays, and its selector names it. */
const linkRemovedOn = (
  condition: string,
  name = "Pull requests",
  id = "inner"
) =>
  `<a href="#a" onclick="event.preventDefault(); if (${holdsClickReports} && ${condition}) this.remove()"><span id="${id}" style="display:inline-block">${name}</span></a>`;
const REMOVED_LINK = linkRemovedOn("true");

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
  const cwd = await mkdtemp(join(tmpdir(), "ayme-recorder-compat-"));
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

const stockToolActions = (file: string) => stockToolList(file, "actions");

const stockToolRequests = (file: string) => stockToolList(file, "requests");

async function stockToolList(file: string, list: "actions" | "requests") {
  const cli = projectPlaywrightCli(projectDir)!;
  const cwd = await mkdtemp(join(tmpdir(), "ayme-recorder-compat-"));
  const tool = (...args: string[]) =>
    promisify(execFile)(process.execPath, [cli, "trace", ...args], {
      cwd,
      maxBuffer: 1 << 26,
    }).then(({ stdout }) => stdout);
  try {
    await tool("open", file);
    return await tool(list);
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
    await stockToolEvaluates(
      trace.file,
      trace.positions[snapshotId("snapshot_1")]!,
      title
    )
  ).toBe("One");
  expect(
    await stockToolEvaluates(
      trace.file,
      trace.positions[snapshotId("snapshot_2")]!,
      title
    )
  ).toBe("Two");
  await rm(dirname(trace.file), { recursive: true, force: true });
});

it("keeps no screenshot in the trace, while its DOM snapshots and network log are there", async () => {
  const browser = await onStockPlaywright(BUTTONS);
  await browser.ask({ kind: "startTrace" });
  await browser.toldOf("traceStarted");
  await browser.page.reload();
  await browser.page.locator("#first").waitFor();
  await browser.ask({
    kind: "takeSnapshot",
    snapshot: "snapshot_1",
    page: "page_1",
  });
  await browser.toldOf("snapshotTaken");
  // Screenshots are on only for a trace started with them: a page that
  // paints and changes gives the trace frames to keep.
  await browser.page.evaluate(() => {
    document.querySelector("h1")!.textContent = "Changed";
  });
  await browser.page.waitForTimeout(500);
  await browser.ask({ kind: "stopTrace", keep: true });
  const { trace } = await browser.toldOf("traceStopped");

  const events = await zipText(trace.file, "trace.trace");
  // A screenshot is a frame of the page's screencast: the trace names each
  // one it keeps among its events.
  expect(events).not.toContain("screencast-frame");
  // The DOM snapshots and the network log are still there.
  expect(events).toContain("frame-snapshot");
  const { host } = new URL(browser.url);
  expect(await stockToolRequests(trace.file)).toMatch(
    new RegExp(`GET\\s+200\\s+${host.replaceAll(".", "\\.")}\\s`)
  );
  await rm(dirname(trace.file), { recursive: true, force: true });
});

it.runIf(!attaching)(
  "opens a blank page to start recording, and goes to the URL only once Record holds inputs back, so that the trace holds the first page load",
  async () => {
    const browser = await onStockPlaywright(BUTTONS, { startRecording: true });
    await browser.ask({ kind: "startTrace" });
    await browser.toldOf("traceStarted");
    await browser.ask({ kind: "reportInteractions", on: true });
    await browser.toldOf("reportingInteractions");
    expect(browser.page.url()).toBe("about:blank");

    await browser.ask({ kind: "holdInputs", on: true });
    await browser.toldOf("inputsHeld");
    await expect.poll(() => browser.page.url()).toBe(browser.url);
    await browser.page.locator("#first").waitFor();
    await browser.page.evaluate("window.stayed = true");
    // Holding again, as after Stop and Continue, goes nowhere.
    await browser.ask({ kind: "holdInputs", on: false });
    await browser.toldOf("inputsHeld", ({ on }) => !on);
    await browser.ask({ kind: "holdInputs", on: true });
    await expect
      .poll(
        () =>
          browser.told.filter(
            (signal) => signal.kind === "inputsHeld" && signal.on
          ).length
      )
      .toBe(2);
    expect(await browser.page.evaluate("window.stayed")).toBe(true);

    await browser.ask({ kind: "stopTrace", keep: true });
    const { trace } = await browser.toldOf("traceStopped");
    // The page's own load, as the tool lists it: by its host and path.
    const { host } = new URL(browser.url);
    expect(await stockToolRequests(trace.file)).toMatch(
      new RegExp(`GET\\s+200\\s+${host.replaceAll(".", "\\.")}\\s`)
    );
    await rm(dirname(trace.file), { recursive: true, force: true });
  }
);

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

// The storage state (ticket #1356): --load-storage and --save-storage make
// the library calls Playwright's own codegen makes, on the recorded context.
// Playwright reads the local storage of an origin no page is at from a page
// of its own, which it tells of to no listener: no page is told opened.
it.skipIf(attaching)(
  "loads the storage state file into the recorded context, and saves the context's to the file asked for, with the local storage of an origin no page is at, telling of no page",
  async () => {
    const folder = await mkdtemp(join(tmpdir(), "ayme-recorder-storage-"));
    ends.push(() => rm(folder, { recursive: true, force: true }));
    const saved = join(folder, "saved.json");
    const browser = await onStockPlaywright(BUTTONS, {
      storage: async (url) => {
        const loaded = join(folder, "loaded.json");
        await writeFile(
          loaded,
          JSON.stringify({
            cookies: [
              {
                name: "session",
                value: "s3cret",
                domain: "127.0.0.1",
                path: "/",
                expires: -1,
                httpOnly: false,
                secure: false,
                sameSite: "Lax",
              },
            ],
            origins: [
              {
                origin: new URL(url).origin,
                localStorage: [{ name: "user", value: "ada" }],
              },
            ],
          })
        );
        return { loadStorage: loaded, saveStorage: saved };
      },
    });
    expect(
      await browser.page.evaluate(() => [
        document.cookie,
        localStorage.getItem("user"),
      ])
    ).toEqual(["session=s3cret", "ada"]);
    await browser.page.evaluate(() => localStorage.setItem("theme", "dark"));
    // Another origin of the same server: no page is left at the first one.
    const elsewhere = new URL(browser.url);
    elsewhere.hostname = "localhost";
    await browser.page.goto(elsewhere.href);
    const pagesTold = () =>
      browser.told.filter(
        (signal) => signal.kind === "pageOpened" || signal.kind === "pageClosed"
      ).length;
    const before = pagesTold();

    await browser.ask({ kind: "saveStorage" });
    await browser.toldOf("storageSaved");

    const state = JSON.parse(await readFile(saved, "utf8")) as {
      cookies: unknown[];
      origins: unknown[];
    };
    expect(state.cookies).toContainEqual(
      expect.objectContaining({
        name: "session",
        value: "s3cret",
        domain: "127.0.0.1",
      })
    );
    expect(state.origins).toContainEqual(
      expect.objectContaining({
        origin: new URL(browser.url).origin,
        localStorage: expect.arrayContaining([
          { name: "user", value: "ada" },
          { name: "theme", value: "dark" },
        ]),
      })
    );
    expect(pagesTold()).toBe(before);
  }
);

it.skipIf(attaching)(
  "tells that the storage state could not be saved, naming its file, when the file cannot be written",
  async () => {
    const folder = await mkdtemp(join(tmpdir(), "ayme-recorder-storage-"));
    ends.push(() => rm(folder, { recursive: true, force: true }));
    // A file where the storage file's folder would be.
    await writeFile(join(folder, "not-a-folder"), "");
    const saved = join(folder, "not-a-folder", "saved.json");
    const browser = await onStockPlaywright(BUTTONS, {
      storage: async () => ({ saveStorage: saved }),
    });

    await browser.ask({ kind: "saveStorage" });

    const failed = await browser.toldOf("requestFailed");
    expect(failed.request).toEqual({ kind: "saveStorage" });
    expect(failed.reason).toContain(saved);
  }
);

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

  // No report of it is awaited: the next click's report is named from that
  // click's own note, where Playwright holds the report back.
  await browser.page.evaluate(
    (link) => document.body.insertAdjacentHTML("beforeend", link),
    REMOVED_LINK
  );
  await browser.click(browser.page.locator("#inner"));
  const next = await browser.toldOf(
    "inputHeld",
    (told) => told.input !== input
  );
  await browser.ask({ kind: "passOn", input: next.input });
  // Playwright reported the page going to `?next` before it.
  const { report } = await browser.toldOf(
    "interactionReported",
    (told) => told.report.type === "click"
  );
  expect(namedLine(report)).toMatch(/link "Pull requests"/);
});

it("holds a right-click by its context menu event until it is sent on: the page then gets it once, and Playwright reports a click of the right button", async () => {
  const browser = await onStockPlaywright(`${BUTTONS}
    <script>
      window.events = [];
      for (const type of ["contextmenu", "auxclick", "click"])
        document.addEventListener(type, (event) => {
          event.preventDefault();
          window.events.push(type + " " + event.button);
        });
    </script>`);
  await reporting(browser);
  await browser.ask({ kind: "holdInputs", on: true });
  await browser.toldOf("inputsHeld");

  await browser.click(browser.page.locator("#second"), "right");
  const { input } = await browser.toldOf("inputHeld");
  // The release reaches the page as it comes; the context menu event waits.
  expect(await browser.page.evaluate("window.events")).toEqual(["auxclick 2"]);
  await browser.ask({ kind: "passOn", input });
  await browser.toldOf("inputPassedOn", (told) => told.input === input);

  expect(await browser.page.evaluate("window.events")).toEqual([
    "auxclick 2",
    "contextmenu 2",
  ]);
  const { report } = await browser.toldOf("interactionReported");
  expect(report).toMatchObject({
    type: "click",
    selector: expect.stringContaining("Second"),
    values: { button: "right" },
  });
});

it("holds a middle click by its auxclick until it is sent on: the page then gets it once, and Playwright reports a click of the middle button", async () => {
  const browser = await onStockPlaywright(`${BUTTONS}
    <script>
      window.events = [];
      for (const type of ["auxclick", "click"])
        document.addEventListener(type, (event) => {
          event.preventDefault();
          window.events.push(type + " " + event.button);
        });
    </script>`);
  await reporting(browser);
  await browser.ask({ kind: "holdInputs", on: true });
  await browser.toldOf("inputsHeld");

  await browser.click(browser.page.locator("#second"), "middle");
  const { input, held } = await browser.toldOf("inputHeld");
  expect(held).toEqual({ kind: "click", count: 1, button: "middle" });
  expect(await browser.page.evaluate("window.events")).toEqual([]);
  await browser.ask({ kind: "passOn", input });
  await browser.toldOf("inputPassedOn", (told) => told.input === input);

  expect(await browser.page.evaluate("window.events")).toEqual(["auxclick 1"]);
  const { report } = await browser.toldOf("interactionReported");
  expect(report).toMatchObject({
    type: "click",
    selector: expect.stringContaining("Second"),
    values: { button: "middle" },
  });
});

it("holds a middle click on a checkbox and on a radio, and sends it on without checking either: Playwright reports it as a check or an uncheck that names no button", async () => {
  const browser = await onStockPlaywright(`
    <label><input type="checkbox" id="box"> Box</label>
    <label><input type="radio" id="dot" name="dot"> Dot</label>
    <script>
      window.events = [];
      for (const type of ["auxclick", "click"])
        document.addEventListener(type, (event) =>
          window.events.push(type + " " + event.button + " " + event.target.id));
    </script>`);
  await reporting(browser);
  await browser.ask({ kind: "holdInputs", on: true });
  await browser.toldOf("inputsHeld");

  const sentOn = new Set<unknown>();
  for (const [id, name] of [
    ["box", "checkbox"],
    ["dot", "radio"],
  ] as const) {
    await browser.click(browser.page.locator(`#${id}`), "middle");
    const { input, held } = await browser.toldOf(
      "inputHeld",
      (told) => !sentOn.has(told.input)
    );
    expect(held).toEqual({ kind: "click", count: 1, button: "middle" });
    sentOn.add(input);
    await browser.ask({ kind: "passOn", input });
    await browser.toldOf("inputPassedOn", (told) => told.input === input);

    const { report } = await browser.toldOf(
      "interactionReported",
      (told) => told.report.selector?.includes(name) === true
    );
    expect(report.type).toBe("uncheck");
    expect(report.values["button"]).toBeUndefined();
    expect(await browser.page.locator(`#${id}`).isChecked()).toBe(false);
  }
  expect(await browser.page.evaluate("window.events")).toEqual([
    "auxclick 1 box",
    "auxclick 1 dot",
  ]);
});

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

it("gives the element a person picks for an assertion the ref the adapter's own snapshot gives it, in a frame too, or its nearest listed ancestor's", async () => {
  const browser = await onStockPlaywright(`
    <button id="first">First</button>
    <div role="group" aria-label="Card"><i id="star" style="display:inline-block;width:24px;height:24px;background:gold"></i></div>
    <iframe srcdoc="<button>In frame</button>"></iframe>`);
  const inFrame = browser.page.frameLocator("iframe").getByRole("button");
  await inFrame.waitFor();
  await reporting(browser);
  await browser.ask({ kind: "takeSnapshot", snapshot: "s1", page: "page_1" });
  const { snapshot } = await browser.toldOf("snapshotTaken");
  const refOf = (line: string) =>
    new RegExp(`${line} \\[ref=(\\w+)\\]`).exec(snapshot.tree)?.[1];
  const picks = [
    [browser.page.locator("#first"), refOf(`button "First"`)],
    [inFrame, refOf(`button "In frame"`)],
    [browser.page.locator("#star"), refOf(`group "Card"`)],
  ] as const;
  expect(picks.map(([, ref]) => ref)).toEqual([
    expect.stringMatching(/^e\d+$/),
    expect.stringMatching(/^f1e\d+$/),
    expect.stringMatching(/^e\d+$/),
  ]);

  for (const [index, [element, ref]] of picks.entries()) {
    await browser.ask({ kind: "pick", on: true });
    await browser.toldOf("picking", ({ on }) => on);
    await browser.click(element);
    await expect
      .poll(
        () =>
          browser.told.filter((signal) => signal.kind === "interactionReported")
            .length
      )
      .toBe(index + 1);
    const reported = browser.told.filter(
      (signal) => signal.kind === "interactionReported"
    )[index]!;
    expect(reported.report).toMatchObject({
      type: "assertVisible",
      snapshotTarget: ref,
    });
    await browser.toldOf("picking", ({ on }) => !on);
  }
});

it("gives the element a person picks for an assertion its own ref, when a card the hover opened has another element its selector matches by then", async () => {
  // As on github.com: hovering a pull request's link opens a card whose
  // link holds the same title, and more.
  const browser = await onStockPlaywright(`
    <a href="#" id="pr">chore: release main</a>
    <div id="card"></div>
    <script>
      // Playwright's picking takes "mouseenter"; "mouseover" reaches
      // the page, as GitHub's cards open by it.
      document.getElementById("pr").addEventListener("mouseover", () =>
        setTimeout(() => {
          document.getElementById("card").innerHTML =
            '<a href="#"><h4>chore: release main</h4> #1168</a>';
        }, 50)
      );
    </script>`);
  await reporting(browser);
  await browser.ask({ kind: "takeSnapshot", snapshot: "s1", page: "page_1" });
  const { snapshot } = await browser.toldOf("snapshotTaken");
  const ref = /link "chore: release main" \[ref=(\w+)\]/.exec(
    snapshot.tree
  )?.[1];
  expect(ref).toMatch(/^e\d+$/);
  await browser.ask({ kind: "pick", on: true });
  await browser.toldOf("picking", ({ on }) => on);

  // Hovered, the card opens; then picked.
  const pr = browser.page.locator("#pr");
  const box = (await pr.boundingBox())!;
  await browser.page.mouse.move(box.x + 5, box.y + box.height / 2);
  await browser.page.locator("#card a").waitFor();
  await browser.click(pr);

  const { report } = await browser.toldOf("interactionReported");
  expect(report.type).toBe("assertVisible");
  // Its selector matches the card's link too by now.
  expect(await browser.page.locator(report.selector!).count()).toBe(2);
  expect(report.snapshotTarget).toBe(ref);
  // Playwright's own words for the selector, for a step with no element.
  expect(report.locator).toBe(
    "getByRole('link', { name: 'chore: release main' })"
  );
});

it("records no element for a pick whose selector matches several elements when no picked element was kept: never the first of them", async () => {
  const browser = await onStockPlaywright(`
    <a href="#" id="pr">chore: release main</a>
    <div id="card"></div>
    <script>
      document.getElementById("pr").addEventListener("mouseover", () => {
        setTimeout(() => {
          document.getElementById("card").innerHTML =
            '<a href="#">chore: release main #1</a><a href="#">chore: release main #2</a>';
        }, 50);
        // Added once picking is on, so it runs right after the recorder's
        // own listener: the element kept at the picking click is gone.
        window.addEventListener(
          "click",
          () => delete window.__aymeRecorderPicked,
          { capture: true, once: true }
        );
      });
    </script>`);
  await reporting(browser);
  await browser.ask({ kind: "pick", on: true });
  await browser.toldOf("picking", ({ on }) => on);
  const pr = browser.page.locator("#pr");
  const box = (await pr.boundingBox())!;
  await browser.page.mouse.move(box.x + 5, box.y + box.height / 2);
  await browser.page.locator("#card a").first().waitFor();

  await browser.click(pr);

  const { report } = await browser.toldOf("interactionReported");
  expect(report.type).toBe("assertVisible");
  expect(await browser.page.locator(report.selector!).count()).toBe(3);
  expect(report.snapshotTarget).toBeUndefined();
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

/** The outline drawn over the element picking would pick, in the page's
 * coordinates; null when none is. */
const outlined = (page: Page) =>
  page.evaluate(() => {
    const host = document.querySelector("ayme-recorder-picking");
    if (!host) return null;
    const { x, y, width, height } = host.getBoundingClientRect();
    return { x, y, width, height };
  });
const boxOf = async (element: Locator) => {
  const { x, y, width, height } = (await element.boundingBox())!;
  return {
    x: expect.closeTo(x, 0),
    y: expect.closeTo(y, 0),
    width: expect.closeTo(width, 0),
    height: expect.closeTo(height, 0),
  };
};

it("outlines the element under the mouse while picking, apart from the page's structure and its clickable marks, until the element is picked or picking is left", async () => {
  const browser = await onStockPlaywright(CLICKABLE);
  await reporting(browser);
  const tree = async (snapshot: string) => {
    await browser.ask({ kind: "takeSnapshot", snapshot, page: "page_1" });
    const { snapshot: taken } = await browser.toldOf(
      "snapshotTaken",
      (told) => told.snapshot.id === snapshot
    );
    return taken.tree;
  };
  const mouseOver = async (element: Locator) => {
    const { x, y, width, height } = (await element.boundingBox())!;
    await browser.page.mouse.move(x + width / 2, y + height / 2);
  };
  const before = await tree("before");
  const first = browser.page.locator("#first");
  const inCard = browser.page.getByText("Open the card");
  await browser.ask({ kind: "pick", on: true });
  await browser.toldOf("picking", ({ on }) => on);

  await mouseOver(first);
  await expect.poll(() => outlined(browser.page)).toEqual(await boxOf(first));
  expect(await tree("during")).toBe(before);
  await mouseOver(inCard);
  await expect.poll(() => outlined(browser.page)).toEqual(await boxOf(inCard));

  await browser.click(first);
  await browser.toldOf("picking", ({ on }) => !on);
  await expect.poll(() => outlined(browser.page)).toBeNull();

  await browser.ask({ kind: "pick", on: true });
  await browser.toldOf("picking", ({ on }) => on);
  await mouseOver(first);
  await expect.poll(() => outlined(browser.page)).not.toBeNull();
  await browser.ask({ kind: "pick", on: false });
  await expect.poll(() => outlined(browser.page)).toBeNull();
});

it("outlines the element under the mouse in a frame that loads a new document while picking, until an element is picked anywhere, and in none that loads one after", async () => {
  const browser = await onStockPlaywright(
    `<button id="first">First</button><iframe style="height: 80px" srcdoc="<p>Old</p>"></iframe>`
  );
  await reporting(browser);
  const frame = browser.page.frames()[1]!;
  /** Has the frame load a new document with one button in it. */
  const load = async (name: string) => {
    await browser.page.evaluate((button) => {
      document.querySelector("iframe")!.srcdoc = button;
    }, `<button>${name}</button>`);
    await browser.page
      .frameLocator("iframe")
      .getByRole("button", { name })
      .waitFor();
  };
  const outlinedInFrame = () =>
    frame.evaluate(() => {
      const host = document.querySelector("ayme-recorder-picking");
      if (!host) return null;
      const { width, height } = host.getBoundingClientRect();
      return { width, height };
    });
  const mouseOver = async (name: string) => {
    const button = browser.page
      .frameLocator("iframe")
      .getByRole("button", { name });
    const { x, y, width, height } = (await button.boundingBox())!;
    await browser.page.mouse.move(x + width / 2, y + height / 2);
    return {
      width: expect.closeTo(width, 0),
      height: expect.closeTo(height, 0),
    };
  };
  await browser.ask({ kind: "pick", on: true });
  await browser.toldOf("picking", ({ on }) => on);

  await load("New");
  const box = await mouseOver("New");
  await expect.poll(outlinedInFrame).toEqual(box);

  // The element is picked in the page: the frame's outline goes too.
  await browser.click(browser.page.locator("#first"));
  await browser.toldOf("picking", ({ on }) => !on);
  expect(await outlinedInFrame()).toBeNull();
  await load("After");
  await mouseOver("After");
  await browser.page.waitForTimeout(300);
  expect(await outlinedInFrame()).toBeNull();
});

it("leaves the click to Playwright's picking in a document that loads while it picks, as in one open when it began", async () => {
  const browser = await onStockPlaywright(
    `<button id="b" onclick="window.clicks = (window.clicks ?? 0) + 1">Button</button>`
  );
  await reporting(browser);
  await browser.ask({ kind: "holdInputs", on: true });
  await browser.toldOf("inputsHeld");
  await browser.ask({ kind: "pick", on: true });
  await browser.toldOf("picking", ({ on }) => on);
  // The page goes on to a new document of its own while Playwright picks.
  await browser.page.evaluate(() => (location.href = "?again"));
  await browser.toldOf("pageNavigated", ({ url }) => url.endsWith("?again"));
  await browser.page.locator("#b").waitFor();

  await browser.click(browser.page.locator("#b"));

  // Playwright reports the page's going on as well, before.
  const { report } = await browser.toldOf(
    "interactionReported",
    ({ report }) => report.type === "assertVisible"
  );
  expect(report.selector).toContain("Button");
  await browser.toldOf("picking", ({ on }) => !on);
  expect(browser.told.map(({ kind }) => kind)).not.toContain("inputHeld");
  expect(await browser.page.evaluate("window.clicks ?? 0")).toBe(0);
});

it("leaves the click to Playwright's picking in a frame whose document loads while it picks", async () => {
  const browser = await onStockPlaywright(
    `<iframe srcdoc="<p>Before</p>"></iframe>`
  );
  const frame = browser.page.frameLocator("iframe");
  await frame.getByText("Before").waitFor();
  await reporting(browser);
  await browser.ask({ kind: "holdInputs", on: true });
  await browser.toldOf("inputsHeld");
  await browser.ask({ kind: "pick", on: true });
  await browser.toldOf("picking", ({ on }) => on);
  // The frame goes on to a new document while Playwright picks.
  await browser.page.evaluate(() => {
    document.querySelector("iframe")!.srcdoc =
      "<button id='b' onclick='window.clicks = (window.clicks ?? 0) + 1'>Inside</button>";
  });
  await frame.locator("#b").waitFor();

  await browser.click(frame.locator("#b"));

  const { report } = await browser.toldOf(
    "interactionReported",
    ({ report }) => report.type === "assertVisible"
  );
  expect(report.selector).toContain("Inside");
  expect(browser.told.map(({ kind }) => kind)).not.toContain("inputHeld");
  expect(
    await frame
      .locator("#b")
      .evaluate(() => (window as unknown as { clicks?: number }).clicks ?? 0)
  ).toBe(0);
});

it.runIf(!attaching)(
  "starts a document's gate leaving the click to picking whichever runs first, the gate's script or the start of picking",
  async () => {
    const running = await projectChromium.launch({ headless: true });
    ends.push(() => running.close());
    /** A page whose scripts run the other way round from the adapter's:
     * the starts first, then the gate. How many clicks it held. */
    const reversed = async (picking: boolean) => {
      const page = await running.newPage();
      const held = { count: 0 };
      await page.exposeBinding("held", () => {
        held.count += 1;
      });
      const run = (fn: { toString(): string }, arg: unknown) =>
        page.addInitScript({
          content: `(${fn.toString()})(${JSON.stringify(arg)})`,
        });
      await run(startGate, { on: true, change: 1 });
      if (picking) await run(startPickingIn, { on: true, change: 1 });
      await run(installGate, "held");
      // A document of its own, which the scripts start.
      await page.goto("data:text/html,<button>Pick me</button>");
      const box = (await page.getByRole("button").boundingBox())!;
      await page.mouse.click(box.x + 5, box.y + 5);
      return held;
    };

    // Not picking, the gate holds the click.
    const holding = await reversed(false);
    await expect.poll(() => holding.count).toBe(1);
    // Picking, it leaves the click to Playwright, though it started last.
    const picking = await reversed(true);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(picking.count).toBe(0);
  }
);

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

const drawnCount = (page: Page) =>
  page.evaluate(
    () => document.querySelectorAll("ayme-recorder-highlight").length
  );

/** Every highlight the page draws, in the page's coordinates. */
const drawnBoxes = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("ayme-recorder-highlight")].map((host) => {
      const { x, y, width, height } = host.getBoundingClientRect();
      return { x, y, width, height };
    })
  );

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
      target: { page: "page_1", find: { by: "ref", ref } },
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

it("draws the highlight on every element a selector names on the page as it is now, and nothing when none does", async () => {
  const browser = await onStockPlaywright(
    `<h1>Orders</h1><button id="main">Main</button><button>Twin</button><button>Twin</button>`
  );
  const lookups = [
    ["#main", 1],
    // Look-alikes: each one lights up.
    ['internal:role=button[name="Twin"s]', 2],
    ["#nowhere", 0],
  ] as const;

  for (const [index, [selector, count]] of lookups.entries()) {
    await browser.ask({
      kind: "highlight",
      highlight: index + 1,
      target: { page: "page_1", find: { by: "selector", selector } },
    });
    const { found } = await browser.toldOf(
      "highlighted",
      (told) => told.highlight === index + 1
    );
    expect([selector, found]).toEqual([selector, count > 0]);
    await expect.poll(() => drawnCount(browser.page)).toBe(count);
  }
});

it("draws the highlight on every element a selector names in each frame its frame part matches", async () => {
  const browser = await onStockPlaywright(
    `<iframe srcdoc="<button>Pay</button>"></iframe><iframe srcdoc="<button>Pay</button><button>Pay</button>"></iframe>`
  );
  for (const frame of [0, 1])
    await browser.page
      .frameLocator(`iframe >> nth=${frame}`)
      .getByText("Pay")
      .first()
      .waitFor();

  await browser.ask({
    kind: "highlight",
    highlight: 1,
    target: {
      page: "page_1",
      find: {
        by: "selector",
        selector:
          'iframe >> internal:control=enter-frame >> internal:role=button[name="Pay"s]',
      },
    },
  });

  const { found } = await browser.toldOf("highlighted");
  expect(found).toBe(true);
  await expect.poll(() => drawnCount(browser.page)).toBe(3);
});

/** A frame inside a frame, each moved away from its parent's corner, with
 * a look-alike in each, and one more in a frame of a closed shadow root. */
const OFFSET_FRAMES = `
  <h1>Orders</h1>
  <iframe id="outer" style="margin: 30px 0 0 60px; width: 400px; height: 200px"></iframe>
  <closed-place></closed-place>
  <script>
    document.getElementById("outer").srcdoc =
      '<button>Pay</button><iframe id="inner" style="margin-left: 50px; height: 80px"></iframe>' +
      '<script>document.getElementById("inner").srcdoc = "<button>Pay</button><button>Deep</button>";<\\/script>';
    customElements.define("closed-place", class extends HTMLElement {
      constructor() {
        super();
        this.attachShadow({ mode: "closed" }).innerHTML =
          '<iframe srcdoc="<button>Pay</button>"></iframe>';
      }
    });
  </script>`;

// From Playwright 1.63 the recorder may start the selector of a target in
// a frame inside a frame with "any frame" (`shortensFramePaths` below), and
// 1.62 enters each frame: a step of a Visit already left is looked up by
// it. The adapter finds the frames itself, as Playwright's "any frame"
// does, so that each is moved by its own place in the page.
it("draws the highlight in its place in the page on every element a selector names in a frame inside a frame, entering each frame or starting in any frame, and in each frame it matches in, but in none a closed shadow root keeps from selectors", async () => {
  const browser = await onStockPlaywright(OFFSET_FRAMES);
  const outer = browser.page.frameLocator("#outer");
  const inner = outer.frameLocator("#inner");
  await inner.getByRole("button", { name: "Deep" }).waitFor();
  // The look-alike in the closed shadow root's frame is on the page too.
  await expect
    .poll(async () => {
      const counts = await Promise.all(
        browser.page
          .frames()
          .map((frame) => frame.getByRole("button", { name: "Pay" }).count())
      );
      return counts.reduce((sum, count) => sum + count, 0);
    })
    .toBe(3);
  const deep = await boxOf(inner.getByRole("button", { name: "Deep" }));
  const pays = await Promise.all(
    [outer, inner].map((frame) =>
      boxOf(frame.getByRole("button", { name: "Pay" }))
    )
  );
  const lookups = [
    [
      `#outer >> internal:control=enter-frame >> #inner >> internal:control=enter-frame >> internal:role=button[name="Deep"s]`,
      [deep],
    ],
    [
      `internal:control=any-frame >> internal:role=button[name="Deep"s]`,
      [deep],
    ],
    [
      `internal:control=any-frame >> iframe >> internal:control=enter-frame >> internal:role=button[name="Deep"s]`,
      [deep],
    ],
    // Two frames have a look-alike: each lights up.
    [`internal:control=any-frame >> internal:role=button[name="Pay"s]`, pays],
  ] as const;

  for (const [index, [selector, boxes]] of lookups.entries()) {
    await browser.ask({
      kind: "highlight",
      highlight: index + 1,
      target: { page: "page_1", find: { by: "selector", selector } },
    });
    const { found } = await browser.toldOf(
      "highlighted",
      (told) => told.highlight === index + 1
    );
    expect([selector, found]).toEqual([selector, true]);
    await expect
      .poll(async () => {
        const drawn = await drawnBoxes(browser.page);
        return [selector, drawn.length, drawn];
      })
      .toEqual([selector, boxes.length, expect.arrayContaining([...boxes])]);
  }
});

it("reads the boxes of every element a selector names in one call per frame, not one per element", async () => {
  // Two frames of ten look-alikes each: one selector names all twenty.
  const buttons = Array.from(
    { length: 10 },
    (_, at) => `<button>Twin ${at}</button>`
  ).join("");
  const browser = await onStockPlaywright(
    `<iframe srcdoc="${buttons}"></iframe><iframe srcdoc="${buttons}"></iframe>`
  );
  await browser.page
    .frameLocator("iframe")
    .last()
    .getByText("Twin 9")
    .waitFor();
  await browser.ask({ kind: "startTrace" });
  await browser.toldOf("traceStarted");

  await browser.ask({
    kind: "highlight",
    highlight: 1,
    target: {
      page: "page_1",
      find: {
        by: "selector",
        selector:
          "iframe >> internal:control=enter-frame >> internal:role=button",
      },
    },
  });
  await browser.toldOf("highlighted");
  await browser.ask({ kind: "stopTrace", keep: true });
  const { trace } = await browser.toldOf("traceStopped");

  // Each call is an action of the trace, under the locator it ran on: the
  // boxes are read once in each frame, and no box is read element by
  // element.
  const actions = await stockToolActions(trace.file);
  expect(actions.match(/Bounding box/g) ?? []).toEqual([]);
  expect(
    actions.match(/Evaluate[^\n]*\n\s+getByRole\('button'\)/g)?.length
  ).toBe(2);
  await expect.poll(() => drawnCount(browser.page)).toBe(20);
  await rm(dirname(trace.file), { recursive: true, force: true });
});

/** A to-do list with look-alikes, text with no role, an icon a style
 * draws, and a frame. */
const LABELLED = `
  <style>.destroy::after { content: "×"; }</style>
  <h1>todos</h1>
  <ul>
    <li><input type="checkbox" aria-label="Toggle Todo"><label>Buy milk today</label><button class="destroy"></button></li>
    <li><input type="checkbox" aria-label="Toggle Todo"><label>buy milk</label><button class="destroy"></button></li>
    <li><input type="checkbox" aria-label="Toggle Todo"><label>feed the cat</label><button class="destroy"></button></li>
    <li><input type="checkbox" aria-label="Toggle Todo"><label>buy milk</label><button class="destroy"></button></li>
  </ul>
  <span><strong>4</strong> items left</span>
  <p>Saved</p>
  <p>Not saved</p>
  <ol>
    <li><button aria-label="Docs"></button></li>
    <li>Docs</li>
    <li><button>Help</button></li>
    <li>Help</li>
  </ol>
  <button>Twin</button>
  <iframe srcdoc="<button>Pay</button><button>Twin</button>"></iframe>`;

/** Each label of the page's own snapshot, and every one whose selector
 * the highlight finds other than the element its ref names: nothing, more
 * than it, or another. */
async function labelsFound(browser: Harness) {
  await browser.ask({ kind: "takeSnapshot", snapshot: "s1", page: "page_1" });
  const { snapshot } = await browser.toldOf("snapshotTaken");
  const tree = StructuralTree.fromAriaSnapshotYaml(
    snapshot.tree,
    new SyntheticAriaRefFactory()
  );

  let highlight = 0;
  /** What the highlight of a lookup draws: each box. */
  const drawnFor = async (find: ElementLookup) => {
    highlight += 1;
    await browser.ask({
      kind: "highlight",
      highlight,
      target: { page: "page_1", find },
    });
    const { found } = await browser.toldOf(
      "highlighted",
      (told) => told.highlight === highlight
    );
    return found ? await drawnBoxes(browser.page) : [];
  };
  const named = tree.getAllNodes().flatMap((node) => {
    const label = labelOf(tree, node);
    return label && !isSyntheticRef(node.ref) ? [{ node, label }] : [];
  });
  const key = (boxes: readonly unknown[]) => JSON.stringify(boxes);
  // Each element by its ref, and whose label each box is.
  const owns: unknown[][] = [];
  const atBox = new Map<string, string>();
  for (const { node, label } of named) {
    const own = await drawnFor({ by: "ref", ref: snapshotRef(node.ref) });
    owns.push(own);
    atBox.set(key(own), label.label);
  }
  const missed: unknown[] = [];
  for (const [at, { label }] of named.entries()) {
    const own = owns[at]!;
    const found = await drawnFor({ by: "selector", selector: label.selector });
    if (own.length !== 1 || key(found) !== key(own))
      missed.push({
        label: label.label,
        // What its selector lights up, by the label of the element there.
        finds: found.map((box) => atBox.get(key([box])) ?? box),
        ...(own.length === 1 ? {} : { byItsRef: own }),
      });
  }
  return { labels: named.map(({ label }) => label.label), missed };
}

it("finds by the selector of each element's label, built from the page's own snapshot, that element alone, in a frame too", async () => {
  const browser = await onStockPlaywright(LABELLED);
  await browser.page.frameLocator("iframe").getByText("Pay").waitFor();

  const { labels, missed } = await labelsFound(browser);

  expect(missed).toEqual([]);
  expect(labels).toEqual(
    expect.arrayContaining([
      'heading "todos"',
      // Its text is part of "Buy milk today" too, as Playwright matches it.
      'listitem "buy milk" (2nd of 3)',
      'listitem "Buy milk today"',
      'listitem "feed the cat"',
      'listitem "feed the cat" › checkbox "Toggle Todo"',
      'checkbox "Toggle Todo" (4th of 4)',
      '"items left"',
      'paragraph "Saved"',
      'paragraph "Not saved"',
      // An icon-only button's aria-label is no text, a button's own text
      // is: the snapshot writes both as a name, so neither item is named by
      // a text that may be one.
      'button "Docs"',
      'button "Help"',
      // One in the page and one in the frame: each selector matches in its
      // own document only.
      'button "Twin"',
      'button "Pay"',
    ])
  );
});

/** Items that hold text the page's snapshot leaves out, as hidden, and
 * Playwright's text matching reads: one named by its text alone, ones
 * among look-alikes, and one an item's hidden text makes a look-alike. */
const HIDDEN_TEXT = `
  <ul>
    <li>Buy milk</li>
    <li>Buy <span hidden>oat </span>milk</li>
  </ul>
  <ol>
    <li><input type="checkbox" aria-label="Toggle Todo">Feed the cat</li>
    <li><input type="checkbox" aria-label="Toggle Todo">Eggs<span hidden> feed the cat</span></li>
    <li><input type="checkbox" aria-label="Toggle Todo">Feed the cat</li>
  </ol>
  <p>Only <span style="display: none">one </span>item</p>`;

// A known limit, which the Recorder guide tells as a highlight that can
// land on a look-alike. Once a label here finds its element, the limit is
// gone: expect no misses.
it("finds by the selector of a label nothing, or a look-alike, when hidden text is in the element or in a look-alike", async () => {
  const browser = await onStockPlaywright(HIDDEN_TEXT);

  const { missed } = await labelsFound(browser);

  expect(missed).toEqual([
    // Playwright reads "Buy oat milk".
    { label: 'listitem "Buy milk" (2nd of 2)', finds: [] },
    // Playwright reads the Eggs item as one with "feed the cat" in it.
    {
      label: 'listitem "Feed the cat" (2nd of 2)',
      finds: ['listitem "Eggs"'],
    },
    { label: 'paragraph "Only item"', finds: [] },
  ]);
});

it("draws nothing for a highlight that a clear replaced while the element was still looked up", async () => {
  const browser = await onStockPlaywright(PLACES);
  const { ref } = await refOf(browser, "snapshot_1", "Main");

  // The clear is asked while the element of the first is looked up.
  await Promise.all([
    browser.ask({
      kind: "highlight",
      highlight: 1,
      target: { page: "page_1", find: { by: "ref", ref } },
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
    target: { page: "page_1", find: { by: "ref", ref } },
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
    target: { page: "page_1", find: { by: "ref", ref } },
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
    await stockToolEvaluates(
      trace.file,
      trace.positions[snapshotId("snapshot_1")]!,
      title
    )
  ).toBe("One");
  expect(
    await stockToolEvaluates(
      trace.file,
      trace.positions[snapshotId("snapshot_3")]!,
      title
    )
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
      target: { page: "page_1", find: { by: "ref", ref } },
    });
    await browser.toldOf("highlighted");
    await expect.poll(() => drawn(browser.page)).not.toBeNull();

    await browser.letGo();

    expect(await drawn(browser.page)).toBeNull();
  }
);

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

// Playwright's report gives the ref of the element under the pointer, while
// its selector names the link or the button around it.
it("names a click on an element inside a link by the link, as Playwright's selector does, whether its snapshot lists the element clicked or not", async () => {
  // As on github.com: a label that is a box of its own, which the snapshot
  // lists, and one that is not.
  const browser = await onStockPlaywright(
    `<a href="#a" onclick="event.preventDefault()"><span id="listed" style="display:inline-block">Pull requests</span> <span>12</span></a>
     <a href="#b" onclick="event.preventDefault()"><span id="plain">ayme</span></a>`
  );
  await reporting(browser);

  for (const [inner, link, selected] of [
    // Its name as Playwright's selector writes it, for the report of it.
    ["#listed", 'link "Pull requests 12"', 'name="Pull requests"'],
    ["#plain", 'link "ayme"', 'name="ayme"'],
  ] as const) {
    await browser.click(browser.page.locator(inner));
    const { report } = await browser.toldOf(
      "interactionReported",
      (signal) => signal.report.selector?.includes(selected) === true
    );
    const named = report.target!.ref ?? report.target!.ancestors?.[0];
    expect(report.target!.tree).toMatch(
      new RegExp(`${link}[^\\n]*\\[ref=${named}\\]`)
    );
  }
});

// The page's note of a click names the element it acted on however soon the
// page changes, in a page an attached recorder found open too.
it(`names a click inside a link by the link ${holdsClickReports ? "from the page's note of the click, when the click removes the link" : "through its selector: Playwright reports the click before the page's note of it"} (Playwright ${underTest.version})`, async () => {
  const browser = await onStockPlaywright(REMOVED_LINK);
  await reporting(browser);
  await browser.ask({ kind: "holdInputs", on: true });
  await browser.toldOf("inputsHeld");

  await browser.click(browser.page.locator("#inner"));
  const { input } = await browser.toldOf("inputHeld");
  await browser.ask({ kind: "passOn", input });

  const { report } = await browser.toldOf("interactionReported");
  expect(namedLine(report)).toMatch(/link "Pull requests"/);
});

// Playwright holds a left click's report back to see whether a double click
// follows (1.63 and later), and then reports the double click once, by its
// second click. The second click is sent on while the first one's report may
// still be held back. 1.62 reports the first click, and revises that report
// with the second.
it(`names a double click by the link ${holdsClickReports ? "from the page's note of its second click, which Playwright reports it by" : "in the report of its first click, which Playwright revises with the second"} (Playwright ${underTest.version})`, async () => {
  const browser = await onStockPlaywright(linkRemovedOn("event.detail === 2"));
  await reporting(browser);
  await browser.ask({ kind: "holdInputs", on: true });
  await browser.toldOf("inputsHeld");

  const inner = browser.page.locator("#inner");
  await browser.click(inner);
  await browser.click(inner, "left", 2);
  await expect
    .poll(() => browser.told.filter(({ kind }) => kind === "inputHeld"))
    .toHaveLength(2);
  const [first, second] = browser.told.filter(
    (told) => told.kind === "inputHeld"
  ) as Extract<BrowserSignal, { kind: "inputHeld" }>[];
  await browser.ask({ kind: "passOn", input: first!.input });
  await browser.toldOf("inputPassedOn", (told) => told.input === first!.input);
  await browser.ask({ kind: "passOn", input: second!.input });

  const { report } = await browser.toldOf(
    "interactionReported",
    (told) => told.report.values["clickCount"] === (holdsClickReports ? 2 : 1)
  );
  expect(namedLine(report)).toMatch(/link "Pull requests"/);
});

// Playwright reports a right-click and a middle click before the page's
// note of it is told. A note of an earlier input can name the same element
// under the pointer: the note of the click before it, made when the element
// was inside another button, or the note of the right-click's own release,
// which reaches the page before the click is sent on.
it("names a click on an element the page moved into another button by the button it is in now, never by an earlier input's note", async () => {
  for (const { button, page, before, after } of [
    // Each button keeps its name, and its ref, when the star moves: the
    // note of the click before names button A.
    {
      button: "middle",
      page: `<button id="a" aria-label="Alpha"><span id="child" style="display:inline-block">Star</span></button>
             <button id="b" aria-label="Beta"></button>`,
      before: /button "Alpha"/,
      after: /button "Beta"/,
    },
    // Named by their text, both buttons are renamed when the star moves:
    // a note made before names refs the report's picture no longer lists.
    {
      button: "right",
      page: `<button id="a">Alpha <span id="child" style="display:inline-block">Star</span></button>
             <button id="b" oncontextmenu="event.preventDefault()">Beta</button>`,
      before: /button "Alpha Star"/,
      after: /button "Beta Star"/,
    },
  ] as const) {
    const browser = await onStockPlaywright(page);
    await reporting(browser);
    await browser.ask({ kind: "holdInputs", on: true });
    await browser.toldOf("inputsHeld");
    /** Sends the `count`th held click on, and gives the line of its
     * report's picture that names its target. */
    const named = async (count: number) => {
      await expect
        .poll(() => browser.told.filter(({ kind }) => kind === "inputHeld"))
        .toHaveLength(count);
      const { input } = browser.told.filter(
        (told) => told.kind === "inputHeld"
      )[count - 1] as Extract<BrowserSignal, { kind: "inputHeld" }>;
      await browser.ask({ kind: "passOn", input });
      await expect
        .poll(() =>
          browser.told.filter(({ kind }) => kind === "interactionReported")
        )
        .toHaveLength(count);
      const { report } = browser.told.filter(
        (told) => told.kind === "interactionReported"
      )[count - 1] as Extract<BrowserSignal, { kind: "interactionReported" }>;
      return namedLine(report);
    };

    await browser.click(browser.page.locator("#child"));
    expect(await named(1)).toMatch(before);

    await browser.page.evaluate(() =>
      document.querySelector("#b")!.append(document.querySelector("#child")!)
    );
    await browser.click(browser.page.locator("#child"), button);
    expect(await named(2)).toMatch(after);
  }
});

// Playwright holds a left click back to see whether a double click follows
// (1.63 and later; 1.62 holds nothing back), and reports it when its
// recorder is switched off. The click's report can still be on its way from
// the page then, most of all on a browser reached over a WebSocket, as an
// attached one: the adapter lets it arrive first.
it("reports a click made just before Playwright's recorder is switched off before the switch-off is answered", async () => {
  const browser = await onStockPlaywright(BUTTONS);
  await reporting(browser);

  await browser.click(browser.page.locator("#second"));
  await browser.ask({ kind: "reportInteractions", on: false });
  await browser.toldOf("reportingInteractions", (signal) => !signal.on);

  const reported = browser.told.findIndex(
    (signal) => signal.kind === "interactionReported"
  );
  const answered = browser.told.findIndex(
    (signal) => signal.kind === "reportingInteractions" && !signal.on
  );
  expect(reported).toBeGreaterThanOrEqual(0);
  expect(reported).toBeLessThan(answered);
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

// Issue #1533: a list that comes up under the pointer on the press makes the
// browser give the click to the body. Sent on again, it would reach the list.
it("lets a click the browser gave to another element than the one under the pointer reach the page untouched, and tells of it as there already; behind an input that still waits, it holds it like any other", async () => {
  const browser = await onStockPlaywright(`
    <button id="other">Other</button>
    <h1>Cities</h1>
    <div id="picker" role="group" aria-label="City picker">
      <button id="city" style="display:block;width:200px;height:40px">Lisbon</button>
      <ul id="cities" hidden style="position:absolute;margin:0;padding:0;list-style:none;width:200px;background:#fff">
        <li id="porto" style="height:40px">Porto</li>
        <li style="height:40px">${linkRemovedOn("true", "Faro", "faro")}</li>
      </ul>
    </div>
    <script>
      window.clicks = [];
      document.addEventListener("click", (event) =>
        window.clicks.push(event.target.id || event.target.nodeName));
      const city = document.getElementById("city");
      const cities = document.getElementById("cities");
      city.addEventListener("mousedown", () => {
        const { left, top } = city.getBoundingClientRect();
        cities.style.left = left + scrollX + "px";
        cities.style.top = top + scrollY + "px";
        cities.hidden = false;
      });
      cities.addEventListener("click", () => (cities.hidden = true));
    </script>`);
  const clicks = () => browser.page.evaluate("window.clicks");
  const listUp = () => browser.page.locator("#cities").isVisible();
  const heldSoFar = () =>
    browser.told.filter((signal) => signal.kind === "inputHeld");
  await reporting(browser);
  await browser.ask({ kind: "holdInputs", on: true });
  await browser.toldOf("inputsHeld");

  // Behind a click that still waits, it is held too: neither reaches the
  // page, and it is sent on at its place, to the list.
  await browser.click(browser.page.locator("#other"));
  const other = await browser.toldOf("inputHeld");
  await browser.click(browser.page.locator("#city"));
  await expect.poll(() => heldSoFar().length).toBe(2);
  const behind = heldSoFar()[1]!;
  expect(behind.held).toEqual({ kind: "click", count: 1 });
  expect(await clicks()).toEqual([]);
  await browser.ask({ kind: "passOn", input: other.input });
  await browser.toldOf("inputPassedOn", ({ input }) => input === other.input);
  await browser.ask({ kind: "passOn", input: behind.input });
  await browser.toldOf("inputPassedOn", ({ input }) => input === behind.input);
  await expect.poll(clicks).toEqual(["other", "porto"]);
  expect(await listUp()).toBe(false);

  // With nothing waiting, it reaches the page as it came: the group that
  // holds the select and its list gets it, and the list stays up.
  await browser.click(browser.page.locator("#city"));
  await expect.poll(() => heldSoFar().length).toBe(3);
  const untouched = heldSoFar()[2]!;
  expect(untouched.held).toEqual({
    kind: "click",
    count: 1,
    reachedAt: expect.any(Number),
  });
  expect(await clicks()).toEqual(["other", "porto", "picker"]);
  expect(await listUp()).toBe(true);

  // A pick sent on right away, while Playwright still holds the click's
  // report, half a second for a double click (1.63 and later): each report
  // still names its own click's element, the group and the link the pick
  // removed, which only the pick's own note names (`linkRemovedOn`). On a
  // run slower than that half second the click's report comes first, and
  // the test checks only that.
  const reports = () =>
    browser.told.filter((signal) => signal.kind === "interactionReported");
  await browser.click(browser.page.locator("#faro"));
  await expect.poll(() => heldSoFar().length).toBe(4);
  const pick = heldSoFar()[3]!;
  await browser.ask({ kind: "passOn", input: pick.input });
  await browser.toldOf("inputPassedOn", ({ input }) => input === pick.input);
  await expect.poll(() => reports().length, { timeout: 10_000 }).toBe(4);
  expect(
    reports()
      .slice(2)
      .map(({ report }) => namedLine(report))
  ).toEqual([
    expect.stringContaining('group "City picker"'),
    expect.stringContaining('link "Faro"'),
  ]);

  // There is nothing to pass on for the click: asked to, the browser sends
  // the page no click.
  await browser.ask({ kind: "passOn", input: untouched.input });
  await new Promise((resolve) => setTimeout(resolve, 500));
  expect(await clicks()).toEqual(["other", "porto", "picker", "faro"]);
});

/** A page with a button, and a frame whose select opens its list on the
 * press, under the pointer. */
const PICKER_IN_FRAME = `
    <button>Top</button>
    <iframe id="picker" title="Picker" style="width:300px;height:160px"></iframe>
    <template id="picker-page">
      <div role="group" aria-label="City picker">
        <button id="city" style="display:block;width:200px;height:40px">Lisbon</button>
        <ul id="cities" hidden style="position:absolute;margin:0;padding:0;list-style:none;width:200px;background:#fff">
          <li style="height:40px">Porto</li>
        </ul>
      </div>
      <script>
        const city = document.getElementById("city");
        const cities = document.getElementById("cities");
        city.addEventListener("mousedown", () => {
          const { left, top } = city.getBoundingClientRect();
          cities.style.left = left + "px";
          cities.style.top = top + "px";
          cities.hidden = false;
        });
      </script>
    </template>
    <script>
      document.getElementById("picker").srcdoc =
        document.getElementById("picker-page").innerHTML;
    </script>`;

// Each document holds its own inputs: one that reached a frame untouched
// can reach it ahead of a click the page still holds, and Playwright then
// reports it first. The adapter names the click its report is of.
it("names the click a report is of when one that reached a frame untouched overtakes a click the page still holds", async () => {
  const browser = await onStockPlaywright(PICKER_IN_FRAME);
  const frame = browser.page.frameLocator("#picker");
  const city = frame.getByRole("button", { name: "Lisbon" });
  await city.waitFor();
  await reporting(browser);
  await browser.ask({ kind: "holdInputs", on: true });
  await browser.toldOf("inputsHeld");

  await browser.click(browser.page.getByRole("button", { name: "Top" }));
  const top = await browser.toldOf("inputHeld");
  await browser.click(city);
  const untouched = await browser.toldOf(
    "inputHeld",
    ({ held }) => held?.kind === "click" && held.reachedAt !== undefined
  );
  const first = await browser.toldOf("interactionReported");
  expect(first.of).toBe(untouched.input);
  expect(namedLine(first.report)).toContain('group "City picker"');

  await browser.ask({ kind: "passOn", input: top.input });
  const second = await browser.toldOf(
    "interactionReported",
    (signal) => signal !== first
  );
  expect(second.of).toBeUndefined();
  expect(second.report.selector).toContain("Top");
});

it("holds as a press exactly the keys Playwright reports as a press: a letter typed in a field is typing; Enter, an arrow key, Control with a letter and Tab are presses", async () => {
  const browser = await onStockPlaywright(
    `<label>Item <input id="item" /></label>`
  );
  await reporting(browser);
  await browser.ask({ kind: "holdInputs", on: true });
  await browser.toldOf("inputsHeld");
  await browser.page.locator("#item").focus();

  // Tab last: it takes the focus out of the field.
  const keys = ["a", "Enter", "ArrowDown", "Control+a", "Tab"];
  const seen: { key: string; gate: boolean; playwright: boolean }[] = [];
  for (const key of keys) {
    const before = browser.told.length;
    // Given over the test's own connection, as a person's keys are. A page
    // that holds inputs holds every key, saying whether it is a press.
    await browser.page.keyboard.press(key);
    const { input, held } = await browser.toldOf(
      "inputHeld",
      (signal) => browser.told.indexOf(signal) >= before
    );
    await browser.ask({ kind: "passOn", input });
    await browser.toldOf("inputPassedOn", (signal) => signal.input === input);
    // Playwright reports a key at once, holding nothing back.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const pressed = browser.told
      .slice(before)
      .some(
        (signal) =>
          signal.kind === "interactionReported" &&
          signal.report.type === "press"
      );
    seen.push({ key, gate: held?.kind === "press", playwright: pressed });
  }

  expect(seen).toEqual([
    { key: "a", gate: false, playwright: false },
    { key: "Enter", gate: true, playwright: true },
    { key: "ArrowDown", gate: true, playwright: true },
    { key: "Control+a", gate: true, playwright: true },
    { key: "Tab", gate: true, playwright: true },
  ]);
});

/** A page with a button, a frame with one, and a frame inside it with one. */
const FRAMES_IN_FRAMES = `
    <button>Top</button>
    <iframe id="outer" title="Outer"></iframe>
    <script>
      document.getElementById("outer").srcdoc =
        '<button>Middle</button><iframe id="inner" title="Inner"></iframe>' +
        '<script>document.getElementById("inner").srcdoc = "<button>Deep</button>";<\\/script>';
    </script>`;

/** Whether the Playwright under test shortens the way to a frame inside a
 * frame: from 1.63 it starts the selector with `internal:control=any-frame`
 * and enters only as many frames as it needs to find the target's frame
 * uniquely (`buildFullSelectorForFrame`); 1.62 enters each frame. */
const shortensFramePaths = (() => {
  const [major = 0, minor = 0] = underTest.version.split(".").map(Number);
  return major > 1 || minor >= 63;
})();

// How deep in frames a target is, as the timeline reads it from the
// selector Playwright reports (`scopesFor` in timeline/domain/target.ts): the
// steps of the selector, split at " >> ", that enter a frame.
it(`reports a click with a selector that enters its frame once, a click in the page with none, and a click in a frame inside a frame ${shortensFramePaths ? "by any frame" : "entering each frame"} (Playwright ${underTest.version})`, async () => {
  const browser = await onStockPlaywright(FRAMES_IN_FRAMES);
  const outer = browser.page.frameLocator("#outer");
  const inner = outer.frameLocator("#inner");
  await inner.getByRole("button", { name: "Deep" }).waitFor();
  await reporting(browser);

  for (const button of [
    browser.page.getByRole("button", { name: "Top" }),
    outer.getByRole("button", { name: "Middle" }),
    inner.getByRole("button", { name: "Deep" }),
  ]) {
    const before = browser.told.length;
    await browser.click(button);
    await browser.toldOf(
      "interactionReported",
      (signal) => browser.told.indexOf(signal) >= before
    );
  }

  const [top, middle, deep] = browser.told.flatMap((signal) =>
    signal.kind === "interactionReported"
      ? [signal.report.selector!.split(" >> ")]
      : []
  );
  const enters = (steps: string[]) =>
    steps.filter((step) => step === "internal:control=enter-frame").length;
  const anyFrame = (steps: string[]) =>
    steps.includes("internal:control=any-frame");
  expect([top, middle, deep].map((steps) => steps!.at(-1))).toEqual([
    expect.stringContaining("Top"),
    expect.stringContaining("Middle"),
    expect.stringContaining("Deep"),
  ]);
  expect([enters(top!), anyFrame(top!)]).toEqual([0, false]);
  expect([enters(middle!), anyFrame(middle!)]).toEqual([1, false]);
  if (shortensFramePaths) {
    expect(deep![0]).toBe("internal:control=any-frame");
    expect(enters(deep!)).toBeLessThan(2);
  } else expect([enters(deep!), anyFrame(deep!)]).toEqual([2, false]);
});

it(`gives a click in a frame inside a frame the target ref of its element, through the adapter and the timeline's rule (Playwright ${underTest.version})`, async () => {
  const browser = await onStockPlaywright(FRAMES_IN_FRAMES);
  const deep = browser.page
    .frameLocator("#outer")
    .frameLocator("#inner")
    .getByRole("button", { name: "Deep" });
  await deep.waitFor();
  await reporting(browser);
  await browser.ask({ kind: "holdInputs", on: true });
  await browser.toldOf("inputsHeld");
  const { page } = await browser.toldOf("pageOpened");

  // As the recorder records a held click: its "before", then the click.
  await browser.click(deep);
  const { input } = await browser.toldOf("inputHeld");
  await browser.ask({ kind: "takeSnapshot", snapshot: "before", page });
  const { snapshot } = await browser.toldOf("snapshotTaken");
  await browser.ask({ kind: "passOn", input });
  const { report } = await browser.toldOf("interactionReported");

  const timeline = new Timeline();
  await timeline.add({
    kind: "visit",
    page,
    url: snapshot.url,
    cause: "initial",
  });
  await timeline.add({ kind: "snapshot", snapshot });
  await timeline.add({
    kind: "interaction",
    interaction: {
      page,
      report,
      before: snapshot.id,
      after: snapshot.id,
      at: 0,
    },
  });

  const [entry] = timeline.visits()[0]!.entries;
  const deepRef = /button "Deep"[^\n]*\[ref=(\w+)\]/.exec(snapshot.tree)?.[1];
  expect(deepRef).toMatch(/^f\d+e\d+$/);
  expect(entry).toMatchObject({
    kind: "interaction",
    interaction: { type: "click", targetRef: deepRef },
  });
});

it("tells that the page is a Settled Page only once it has stopped changing, for the page and the input the wait was asked for", async () => {
  // A click starts six changes, 150 ms apart: each comes within core's
  // quiet window of the one before, and the last well before its deadline.
  const browser = await onStockPlaywright(`
    <button id="load">Load</button>
    <ul id="items"></ul>
    <script>
      document.getElementById("load").addEventListener("click", () => {
        let added = 0;
        const add = () => {
          const item = document.createElement("li");
          item.textContent = "Item " + ++added;
          document.getElementById("items").append(item);
          window.lastChange = Date.now();
          if (added < 6) setTimeout(add, 150);
        };
        add();
      });
    </script>`);
  const items = () => browser.page.locator("#items li").count();

  await browser.click(browser.page.locator("#load"));
  await browser.ask({
    kind: "waitForSettled",
    page: "page_1",
    input: "input_1",
  });

  expect(await browser.toldOf("pageSettled")).toEqual({
    kind: "pageSettled",
    page: "page_1",
    input: "input_1",
  });
  const settled = Date.now();
  expect(await items()).toBe(6);
  expect(await browser.page.evaluate("window.lastChange")).toBeLessThan(
    settled
  );
});

it("counts every key typed into a field as the page's activity: it is a Settled Page only once typing has been quiet", async () => {
  // Typing changes a field's value and nothing of the page's structure.
  const browser = await onStockPlaywright(`<input id="field" />`);
  const field = browser.page.locator("#field");
  await field.focus();

  await browser.ask({
    kind: "waitForSettled",
    page: "page_1",
    input: "input_1",
  });
  // A key every 150 ms, under the quiet a Settled Page needs, for about a
  // second, well within the deadline.
  for (const key of "abcdef") {
    await browser.page.keyboard.type(key);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  // No moment between two keys was quiet long enough.
  const settledWhileTyping = browser.told.some(
    ({ kind }) => kind === "pageSettled"
  );

  await browser.toldOf("pageSettled");
  expect(await field.inputValue()).toBe("abcdef");
  expect(settledWhileTyping).toBe(false);
});

it("holds every key while a held input waits, and lets keys reach the page again once asked to, unless the page held an input after the last one named", async () => {
  const browser = await onStockPlaywright(
    `<label>Item <input id="item" /></label>`
  );
  const typed = () => browser.page.locator("#item").inputValue();
  const held = () =>
    browser.told.filter((signal) => signal.kind === "inputHeld");
  /** Types one key, and the gate's answer: the input it held, if any. */
  const type = async (key: string) => {
    const before = held().length;
    await browser.page.keyboard.type(key);
    await new Promise((resolve) => setTimeout(resolve, 500));
    return held()[before];
  };
  const passOn = async (input: string) => {
    await browser.ask({ kind: "passOn", input });
    await browser.toldOf("inputPassedOn", (signal) => signal.input === input);
  };
  /** Nothing answers the request: the next key waits a moment for it. */
  const letThrough = async (upTo: string) => {
    await browser.ask({ kind: "letInputsThrough", page: "page_1", upTo });
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  };
  await reporting(browser);
  await browser.page.locator("#item").focus();
  await browser.ask({ kind: "holdInputs", on: true });
  await browser.toldOf("inputsHeld");

  // From Record on, every key is held, typing included.
  const a = (await type("a"))!;
  const b = (await type("b"))!;
  expect(await typed()).toBe("");
  await passOn(a.input);
  await passOn(b.input);
  await expect.poll(typed).toBe("ab");

  // The page held b after a: letting through up to a still holds keys.
  await letThrough(a.input);
  const c = (await type("c"))!;
  expect(c).toBeDefined();
  expect(await typed()).toBe("ab");
  await passOn(c.input);
  await expect.poll(typed).toBe("abc");

  // Up to the last input the page held: the next key is the page's own.
  await letThrough(c.input);
  expect(await type("d")).toBeUndefined();
  await expect.poll(typed).toBe("abcd");
  expect(held()).toHaveLength(3);
});

/** The warning of a document whose gate left an input to the page because
 * Playwright would not hear of it. */
const unheardAt = (address: string) => ({
  kind: "notRecorded",
  message: `Inputs on ${address} are not recorded: the page changed JSON.stringify, or how it writes an object, as Prototype.js 1.6 does, and Playwright reports every input through it. The inputs still reach the page. Stop and finish in the recorder window, at the address the recorder printed.`,
});
const notRecorded = (browser: Harness) =>
  browser
    .toldOf("browserWarned", ({ warning }) => warning.kind === "notRecorded")
    .then(({ warning }) => warning);
const MARK = `<button id="mark" onclick="this.textContent = 'Marked'">Mark</button>
  <label>Item <input id="item" /></label>`;
const PROTOTYPE_JS = `Object.defineProperty(Array.prototype, "toJSON", { configurable: true, value() { return "[" + this.map((item) => JSON.stringify(item)).join(", ") + "]"; } });`;
const REPLACED = `JSON.stringify = () => '{"tampered":true}';`;

/** A click and typing on the page, and what reached it. */
async function clickAndType(browser: Harness) {
  await browser.click(browser.page.locator("#mark"));
  await expect
    .poll(() => browser.page.locator("#mark").textContent())
    .toBe("Marked");
  await browser.page.locator("#item").focus();
  await browser.page.keyboard.type("ab");
  await expect
    .poll(() => browser.page.locator("#item").inputValue())
    .toBe("ab");
}

async function holding(browser: Harness) {
  await reporting(browser);
  await browser.ask({ kind: "holdInputs", on: true });
  await browser.toldOf("inputsHeld");
}

it.each([
  [
    "gives arrays a toJSON that writes them as a string, as Prototype.js 1.6 does",
    PROTOTYPE_JS,
  ],
  ["replaced JSON.stringify", REPLACED],
])(
  "leaves a click and typing to a page that %s, and warns that its inputs are not recorded: Playwright's bindings write every call with the page's JSON.stringify",
  async (_, script) => {
    const browser = await onStockPlaywright(
      `<script>${script}</script>${MARK}`
    );
    await holding(browser);

    await clickAndType(browser);

    expect(await notRecorded(browser)).toEqual(unheardAt(browser.url));
  }
);

it("holds a click on a page whose JSON.parse throws, which Playwright's calls do not use, and gives no warning", async () => {
  const browser = await onStockPlaywright(
    `<script>JSON.parse = () => { throw new Error("tampered JSON.parse"); };</script>${MARK}`
  );
  await holding(browser);

  await browser.click(browser.page.locator("#mark"));

  await browser.toldOf("inputHeld");
  expect(
    browser.told.filter((signal) => signal.kind === "browserWarned")
  ).toEqual([]);
});

it("warns once of a document, however many inputs it leaves to the page, and once again of the next", async () => {
  const browser = await onStockPlaywright(
    `<script>${REPLACED}</script>${MARK}`
  );
  await holding(browser);
  const warnings = () =>
    browser.told.filter(
      (signal) =>
        signal.kind === "browserWarned" && signal.warning.kind === "notRecorded"
    );

  await clickAndType(browser);
  await browser.click(browser.page.locator("#mark"));
  await expect.poll(() => warnings().length).toBe(1);
  await new Promise((resolve) => setTimeout(resolve, 500));
  expect(warnings()).toHaveLength(1);

  await browser.page.reload();
  await browser.click(browser.page.locator("#mark"));

  await expect.poll(() => warnings().length).toBe(2);
});

it("answers Stop for a page that replaced JSON.parse and JSON.stringify after its gate was in", async () => {
  const browser = await onStockPlaywright(MARK);
  await holding(browser);
  await browser.page.evaluate(
    `JSON.parse = () => { throw new Error("tampered JSON.parse"); }; ${REPLACED}`
  );
  await browser.click(browser.page.locator("#mark"));
  await expect
    .poll(() => browser.page.locator("#mark").textContent())
    .toBe("Marked");

  await stopAndContinue(browser, async () => {});
});

it("installs the gate on a page that made console.debug no function, and holds its click", async () => {
  const browser = await onStockPlaywright(
    `<script>console.debug = 1;</script>${MARK}`
  );
  await holding(browser);

  await browser.click(browser.page.locator("#mark"));

  await browser.toldOf("inputHeld");
});

it("warns of a document that changes JSON.stringify after Record, and leaves its click to it", async () => {
  const browser = await onStockPlaywright(MARK);
  await holding(browser);
  await browser.page.evaluate(REPLACED);

  await clickAndType(browser);

  expect(await notRecorded(browser)).toEqual(unheardAt(browser.url));
});

it("warns of a frame from another site, added after the page loaded, by the frame's own address, and leaves its click to it", async () => {
  const browser = await onStockPlaywright(
    `<script>if (location.pathname === "/child") ${REPLACED}</script>${MARK}`
  );
  await holding(browser);
  const child = `${browser.url.replace("127.0.0.1", "localhost")}child`;
  await browser.page.evaluate((src) => {
    const frame = document.createElement("iframe");
    frame.src = src;
    document.body.append(frame);
  }, child);
  const mark = browser.page.frameLocator("iframe").locator("#mark");
  await mark.waitFor();

  await browser.click(mark);

  await expect.poll(() => mark.textContent()).toBe("Marked");
  expect(await notRecorded(browser)).toEqual(unheardAt(child));
});

/** Resolves once a signal told from `since` on matches. */
const toldSince = (
  browser: Harness,
  since: number,
  matches: (signal: BrowserSignal) => boolean
) =>
  expect
    .poll(() => browser.told.slice(since).some(matches), { timeout: 10_000 })
    .toBe(true);

/** Stop and Continue, in the order the engine asks for them, each request
 * once the one before is answered: Stop lets inputs through, then switches
 * Playwright's recorder off; Continue switches it on, then holds inputs. */
async function stopAndContinue(browser: Harness, between: () => Promise<void>) {
  const steps: [Written<BrowserRequest>, (signal: BrowserSignal) => boolean][] =
    [
      [
        { kind: "holdInputs", on: false },
        (signal) => signal.kind === "inputsHeld" && !signal.on,
      ],
      [
        { kind: "reportInteractions", on: false },
        (signal) => signal.kind === "reportingInteractions" && !signal.on,
      ],
    ];
  const again: typeof steps = [
    [
      { kind: "reportInteractions", on: true },
      (signal) => signal.kind === "reportingInteractions" && signal.on,
    ],
    [
      { kind: "holdInputs", on: true },
      (signal) => signal.kind === "inputsHeld" && signal.on,
    ],
  ];
  for (const [request, answered] of steps) {
    const since = browser.told.length;
    await browser.ask(request);
    await toldSince(browser, since, answered);
  }
  await between();
  for (const [request, answered] of again) {
    const since = browser.told.length;
    await browser.ask(request);
    await toldSince(browser, since, answered);
  }
}

/** A click on `page`'s #mark, held, read and sent on as the engine asks,
 * and reported by Playwright. */
async function recordClick(browser: Harness, page: Page, id: string) {
  const held = browser.told.filter((signal) => signal.kind === "inputHeld");
  await browser.click(page.locator("#mark"));
  await expect
    .poll(
      () => browser.told.filter((signal) => signal.kind === "inputHeld").length
    )
    .toBe(held.length + 1);
  const { input } = browser.told.filter(
    (signal) => signal.kind === "inputHeld"
  )[held.length] as Extract<BrowserSignal, { kind: "inputHeld" }>;
  await browser.ask({ kind: "takeSnapshot", snapshot: "s1", page: id });
  await browser.toldOf("snapshotTaken");
  await browser.ask({ kind: "passOn", input });
  await expect.poll(() => page.locator("#mark").textContent()).toBe("Marked");
  await browser.toldOf("interactionReported");
}

it("records a click again once a page whose calls were lost can be heard, after Stop and Continue", async () => {
  const browser = await onStockPlaywright(
    `<script>window.realStringify = JSON.stringify; ${REPLACED}</script>${MARK}`
  );
  await holding(browser);

  await stopAndContinue(browser, () =>
    browser.page.evaluate("JSON.stringify = window.realStringify")
  );

  await recordClick(browser, browser.page, "page_1");
});

it("records a click on a page after Stop and Continue while another tab's calls are lost", async () => {
  const browser = await onStockPlaywright(
    `<script>if (location.pathname === "/broken") ${REPLACED}</script>${MARK}`
  );
  const [broken] = await Promise.all([
    browser.page.context().waitForEvent("page"),
    browser.page.evaluate((url) => window.open(url), `${browser.url}broken`),
  ]);
  await broken.locator("#mark").waitFor();
  await holding(browser);

  await stopAndContinue(browser, async () => {});

  await recordClick(browser, browser.page, "page_1");
});
