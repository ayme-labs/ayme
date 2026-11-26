// The pages' own code, which the tests run there, uses the DOM.
/// <reference lib="dom" />
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer as createNetServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect, Exit, Scope } from "effect";
import { chromium, type BrowserContext, type Dialog } from "playwright-core";
import { afterEach, expect, it } from "vitest";

import { browser, projectPlaywright, type BrowserRequest } from "../../index";

// The compatibility suite: this package on each supported Playwright, on
// real Chromium, starting a browser and joining one. CI runs it once per
// supported version, and the weekly canary against the newest one.
//
// The Playwright under test is the one installed in the project folder that
// AYME_PLAYWRIGHT_PROJECT names, or else this package's own. The test's own
// connections use this package's Playwright, which needs no browser to
// connect.
const projectDir =
  process.env.AYME_PLAYWRIGHT_PROJECT ??
  fileURLToPath(new URL("../../..", import.meta.url));

const underTest = await Effect.runPromise(projectPlaywright(projectDir));
/** The Chromium of the Playwright under test, which starts the running
 * browser a join finds: each version needs only the browser build it
 * installs. */
const { chromium: projectChromium } = underTest.playwright;

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

/** Gets the browser in a scope of its own, and the means to release it. */
async function got(request: BrowserRequest) {
  const scope = await Effect.runPromise(Scope.make());
  const release = () => Effect.runPromise(Scope.close(scope, Exit.void));
  ends.push(release);
  const had = await Effect.runPromise(
    browser(underTest, request).pipe(Scope.provide(scope))
  );
  return { ...had, release };
}

/** Someone else's browser, running before ayme comes, with a page open and
 * the dark colour scheme as its own setting, not Playwright's. */
async function running(): Promise<{
  address: string;
  context: BrowserContext;
}> {
  const port = await freePort();
  const context = await projectChromium.launchPersistentContext("", {
    headless: true,
    // Playwright emulates no colour scheme: the browser keeps its own.
    colorScheme: null,
    args: [
      `--remote-debugging-port=${port}`,
      "--blink-settings=preferredColorScheme=0",
    ],
  });
  ends.push(() => context.close());
  await context.pages()[0]!.goto("data:text/html,<p>Someone's page</p>");
  return { address: `http://127.0.0.1:${port}`, context };
}

/** A monospace font installed with the system, which a tab sets as its own
 * cursive font. */
const OWN_FONT = process.platform === "darwin" ? "Courier" : "Monospace";

const prefersDark = (page: { evaluate<T>(fn: () => T): Promise<T> }) =>
  page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches);

it(`finds the Playwright under test, with the version it has installed (Playwright ${underTest.version})`, () => {
  const installed = ["playwright", "@playwright/test", "playwright-core"]
    .map((name) => {
      try {
        return JSON.parse(
          readFileSync(
            join(projectDir, "node_modules", name, "package.json"),
            "utf8"
          )
        ) as { version: string };
      } catch {
        return undefined;
      }
    })
    .find(Boolean);

  expect(underTest.version).toBe(installed?.version);
});

it("starts Chromium, with its DevTools protocol on the debug port, and a page loads in it", async () => {
  const debugPort = await freePort();

  const started = await got({ open: { headed: false, debugPort } });

  expect(started.opened).toBe(true);
  const page = await started.playwrightBrowser.newPage();
  await page.setContent("<button>Ready</button>");
  expect(await page.getByRole("button").textContent()).toBe("Ready");
  // Another client reaches the same browser at its address.
  const other = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
  ends.push(() => other.close());
  expect(other.contexts().flatMap((context) => context.pages())).toHaveLength(
    1
  );
});

it("starts Chromium on a profile of its own whose tab list, headless too, names the most recently active tab first", async () => {
  const debugPort = await freePort();
  const profile = mkdtempSync(join(tmpdir(), "ayme-profile-"));
  ends.push(async () => rmSync(profile, { recursive: true, force: true }));
  const started = await got({ open: { headed: false, debugPort, profile } });
  const [context] = started.playwrightBrowser.contexts();
  const first = context!.pages()[0]!;
  await first.goto("data:text/html,<p>first</p>");
  const second = await context!.newPage();
  await second.goto("data:text/html,<p>second</p>");
  const front = async () => {
    const list = (await (
      await fetch(`http://127.0.0.1:${debugPort}/json/list`)
    ).json()) as { type: string; url: string }[];
    return list.find(({ type }) => type === "page")?.url;
  };
  expect(await front()).toBe("data:text/html,<p>second</p>");

  await first.bringToFront();

  await expect.poll(front).toBe("data:text/html,<p>first</p>");
});

it("closes a browser it started when it releases it", async () => {
  const debugPort = await freePort();
  const started = await got({ open: { headed: false, debugPort } });
  const other = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
  const gone = new Promise<void>((resolve) =>
    other.on("disconnected", () => resolve())
  );

  await started.release();

  await gone;
  expect(started.playwrightBrowser.isConnected()).toBe(false);
});

it("starts Chromium on a profile of its own, whose one context a client that joins it shares, and closes it when it releases it", async () => {
  const debugPort = await freePort();
  const profile = mkdtempSync(join(tmpdir(), "ayme-profile-"));
  ends.push(async () => rmSync(profile, { recursive: true, force: true }));
  const started = await got({ open: { headed: false, debugPort, profile } });
  await started.playwrightBrowser
    .contexts()[0]!
    .pages()[0]!
    .goto("data:text/html,<p>ayme's page</p>");

  const other = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
  const gone = new Promise<void>((resolve) =>
    other.on("disconnected", () => resolve())
  );
  expect(
    other.contexts().map((context) => context.pages().map((page) => page.url()))
  ).toEqual([["data:text/html,<p>ayme's page</p>"]]);

  await started.release();
  await gone;
});

it("joins a running browser at its address, and finds its page", async () => {
  const { address } = await running();

  const joined = await got({ join: { cdp: address } });

  expect(joined.opened).toBe(false);
  const pages = joined.playwrightBrowser
    .contexts()
    .flatMap((context) => context.pages());
  expect(pages.map((page) => page.url())).toEqual([
    "data:text/html,<p>Someone's page</p>",
  ]);
});

it("joins without Playwright's defaults: the page keeps the browser's own colour scheme", async () => {
  const { address, context } = await running();
  expect(await prefersDark(context.pages()[0]!)).toBe(true);

  const joined = await got({ join: { cdp: address } });

  const [page] = joined.playwrightBrowser
    .contexts()
    .flatMap((each) => each.pages());
  expect(await prefersDark(page!)).toBe(true);
  expect(await prefersDark(context.pages()[0]!)).toBe(true);
});

// A record of a limit, not a promise: joining without defaults still sends
// Playwright's own font families to each page of a headless Chromium, which
// ayme cannot stop. A test that sees them kept means Playwright changed.
it("joining a headless browser replaces a tab's own font families with Playwright's", async () => {
  const { address, context } = await running();
  const page = context.pages()[0]!;
  // Text that a monospace font and any other set at different widths.
  await page.setContent(
    `<span id="cursive" style="font-family: cursive">iiiiiWWWWW</span><span id="own" style="font-family: ${OWN_FONT}">iiiiiWWWWW</span>`
  );
  const cdp = await context.newCDPSession(page);
  await cdp.send("Page.setFontFamilies", {
    fontFamilies: { cursive: OWN_FONT },
  });
  const widths = () =>
    page.evaluate(() =>
      ["cursive", "own"].map(
        (id) => document.getElementById(id)!.getBoundingClientRect().width
      )
    );
  const [cursive, own] = await widths();
  expect(cursive).toBe(own);

  await got({ join: { cdp: address } });

  const [cursiveAfter, ownAfter] = await widths();
  expect(cursiveAfter).not.toBe(ownAfter);
});

it("leaves a browser it joined open, with its page where it was, when it releases it", async () => {
  const { address, context } = await running();
  const joined = await got({ join: { cdp: address } });

  await joined.release();

  expect(joined.playwrightBrowser.isConnected()).toBe(false);
  const [page] = context.pages();
  expect(page!.isClosed()).toBe(false);
  expect(page!.url()).toBe("data:text/html,<p>Someone's page</p>");
  expect(await page!.evaluate(() => document.body.textContent)).toBe(
    "Someone's page"
  );
});

/** Opens a dialog in `page`, and resolves with what the page's code was
 * answered. */
const confirmIn = (page: { evaluate<T>(fn: () => T): Promise<T> }) =>
  page.evaluate(() => confirm("Leave the page?"));

it("joining with leaveDialogsOpen leaves a dialog a page opens after the join for the automation to answer", async () => {
  const { address, context } = await running();
  await got({ join: { cdp: address, leaveDialogsOpen: true } });
  // The automation's own listener: without one, its Playwright would
  // dismiss the dialog itself.
  const shown = new Promise<Dialog>((resolve) =>
    context.once("dialog", resolve)
  );

  const answered = confirmIn(context.pages()[0]!);
  const dialog = await shown;
  // ayme had the time to answer it, had it answered dialogs.
  await new Promise((resolve) => setTimeout(resolve, 300));
  await dialog.accept();

  expect(await answered).toBe(true);
});

// A record of a limit, not a promise: Playwright listens to a page as soon
// as the join reaches it, and dismisses a dialog nobody has subscribed to,
// but its public API gives the joining client no object to subscribe on
// until the join completes. The join here stalls on a dialog left open in
// one tab, so the other tab's dialog opens while it is under way.
it("a dialog a tab opens while the join is under way is dismissed by Playwright before ayme can listen", async () => {
  const { address, context } = await running();
  const dialogs: Dialog[] = [];
  context.on("dialog", (dialog) => dialogs.push(dialog));
  const other = await context.newPage();
  const first = confirmIn(context.pages()[0]!);
  await expect.poll(() => dialogs.length).toBe(1);
  let joinedYet = false;
  const joining = got({ join: { cdp: address, leaveDialogsOpen: true } }).then(
    () => (joinedYet = true)
  );
  await new Promise((resolve) => setTimeout(resolve, 500));
  expect(joinedYet).toBe(false);

  const duringJoin = await confirmIn(other);

  expect(duringJoin).toBe(false);
  await dialogs[0]!.accept();
  expect(await first).toBe(true);
  await joining;
});

it("fails, naming the address, when no browser answers there", async () => {
  const address = `http://127.0.0.1:${await freePort()}`;

  const failure = await Effect.runPromise(
    Effect.flip(Effect.scoped(browser(underTest, { join: { cdp: address } })))
  );

  expect(failure).toMatchObject({
    kind: "address unreachable",
    message: expect.stringContaining(
      `Playwright could not connect to the browser at ${address}.`
    ),
  });
});
