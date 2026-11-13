import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { createServer as createNetServer, type AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startRecorder, type Recorder } from "@ayme-dev/recorder";
import {
  chromium,
  test as base,
  type BrowserContext,
  type CDPSession,
  type Locator,
  type Page,
} from "@playwright/test";

export { expect } from "@playwright/test";

/** This app's folder: a project with Playwright installed. */
export const fixtureProject = fileURLToPath(new URL("..", import.meta.url));

// The built command, found as a project finds it: through the package's bin.
const cliManifest = createRequire(import.meta.url).resolve(
  "@ayme-dev/cli/package.json"
);
const cliCommand = join(
  dirname(cliManifest),
  (
    JSON.parse(await readFile(cliManifest, "utf8")) as {
      bin: Record<string, string>;
    }
  ).bin["ayme-recorder"]!
);

// The port is released before the browser binds it, so another process could
// take it in between; the browser then fails to launch and so does the test.
const freePort = () =>
  new Promise<number>((resolve) => {
    const server = createNetServer().listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolve(port));
    });
  });

/** The fixture pages, served for one test. */
export type FixturePages = {
  /** The address of a page in `app/`, such as `/closes-itself.html`. */
  url(path?: string): string;
  /** Every request so far, in order. */
  readonly requests: readonly { path: string; userAgent: string }[];
};

/** One run of `ayme-recorder`, as a child process. */
export type Run = {
  /** Everything it has written to stdout so far. */
  stdout(): string;
  stderr(): string;
  /** Resolves once stdout holds `text`. */
  waitForStdout(text: string): Promise<void>;
  /** Sends the signal the terminal's stop sends. */
  interrupt(): void;
  /** Closes the page at `url` in the recorder's browser, as the person
   * would, over the test's own connection to that browser. */
  closePage(url: string): Promise<void>;
  /** How it ended. */
  readonly exit: Promise<{ code: number | null; signal: string | null }>;
};

/**
 * A person at the recorded browser: input given as raw input events over
 * the test's own connection, so that it reaches the page as a person's does
 * and is no call of the Playwright that records.
 */
export type Person = {
  /** Presses and releases the mouse on the middle of an element. */
  click(target: Locator): Promise<void>;
  /** Presses at one point of the page, moves, and releases at another. */
  drag(from: Point, to: Point): Promise<void>;
  /** The middle of an element, in the page's viewport. */
  middleOf(target: Locator): Promise<Point>;
  /**
   * Waits as a person does between two things: long enough for the page to
   * be a Settled Page and be read. The recorder gives no sign of that yet.
   */
  pause(): Promise<void>;
};
type Point = { x: number; y: number };

/** A recorder started in this process, on a fixture page. */
export type Recording = {
  /** The engine's handle: commands go through it while there is no window. */
  readonly recorder: Recorder;
  /** The recorded page, over the test's own connection to the browser. */
  readonly page: Page;
  readonly person: Person;
  /** The project the recorder runs in, and saves to. */
  readonly projectDir: string;
  /** The person at another page of the recorder's browser, such as one
   * the recorded page opened. */
  personOn(page: Page): Promise<Person>;
};

function personAt(session: CDPSession): Person {
  const mouse = (type: string, at: Point, more: Record<string, unknown> = {}) =>
    session.send("Input.dispatchMouseEvent", {
      type: type as "mouseMoved",
      x: at.x,
      y: at.y,
      button: "none",
      pointerType: "mouse",
      ...more,
    });
  const held = { button: "left", buttons: 1, clickCount: 1 };
  const released = { button: "left", buttons: 0, clickCount: 1 };
  const wait = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));
  const person: Person = {
    async middleOf(target) {
      await target.scrollIntoViewIfNeeded();
      const box = (await target.boundingBox())!;
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    },
    async click(target) {
      const at = await person.middleOf(target);
      await mouse("mouseMoved", at);
      await mouse("mousePressed", at, held);
      await wait(70);
      await mouse("mouseReleased", at, released);
    },
    async drag(from, to) {
      await mouse("mouseMoved", from);
      await mouse("mousePressed", from, held);
      await wait(60);
      const steps = 8;
      for (let step = 1; step <= steps; step += 1) {
        await mouse(
          "mouseMoved",
          {
            x: from.x + ((to.x - from.x) * step) / steps,
            y: from.y + ((to.y - from.y) * step) / steps,
          },
          { button: "left", buttons: 1 }
        );
        await wait(15);
      }
      await mouse("mouseReleased", to, released);
    },
    pause: () => wait(1_000),
  };
  return person;
}

/** A Chromium that runs before the recorder comes, as someone else's: the
 * test launched it, and its connection is another automation client. */
export type RunningBrowser = {
  /** The address of its DevTools protocol. */
  readonly cdpEndpoint: string;
  /** Its one page, over the test's own connection. */
  readonly page: Page;
  readonly context: BrowserContext;
};

export const test = base.extend<{
  /** Which browser `startRecording` records: one the recorder launches, or
   * a running one it attaches to. The project "attach" sets it. */
  recordedBrowser: "launch" | "attach";
  /** Launches a running browser with one page open at `url`. It is closed
   * at the end of the test, after every recorder. */
  runningBrowser: (url: string) => Promise<RunningBrowser>;
  fixturePages: FixturePages;
  /** Runs `ayme-recorder` with these arguments in a project folder. */
  runRecorder: (args: string[], options?: { cwd?: string }) => Promise<Run>;
  /** Starts a recorder in this process on a fixture page such as
   * `/cart.html`. Its project is a folder of the test's own inside this
   * app, so the app's Playwright is the one it finds; or, when
   * AYME_RECORDER_PLAYWRIGHT_PROJECT names a project with another
   * Playwright installed, a folder of the test's own inside that one. */
  startRecording: (path: string) => Promise<Recording>;
}>({
  recordedBrowser: ["launch", { option: true }],

  // eslint-disable-next-line no-empty-pattern
  runningBrowser: async ({}, use) => {
    const running: BrowserContext[] = [];
    await use(async (url) => {
      const debugPort = await freePort();
      const context = await chromium.launchPersistentContext("", {
        headless: true,
        args: [`--remote-debugging-port=${debugPort}`],
      });
      running.push(context);
      const page = context.pages()[0]!;
      await page.goto(url);
      return {
        cdpEndpoint: `http://127.0.0.1:${debugPort}`,
        page,
        context,
      };
    });
    for (const context of running) await context.close();
  },

  startRecording: async (
    { fixturePages, recordedBrowser, runningBrowser },
    use,
    testInfo
  ) => {
    const ends: (() => Promise<unknown>)[] = [];
    /** Project folders made inside another project, removed at the end. */
    const madeInside: string[] = [];
    await use(async (path) => {
      const otherPlaywright = process.env.AYME_RECORDER_PLAYWRIGHT_PROJECT;
      const projectDir = otherPlaywright
        ? await mkdtemp(join(otherPlaywright, "recorder-fixture-"))
        : testInfo.outputPath("project");
      await mkdir(projectDir, { recursive: true });
      if (otherPlaywright) madeInside.push(projectDir);
      const url = fixturePages.url(path);
      const personOn = async (other: Page) =>
        personAt(await other.context().newCDPSession(other));
      if (recordedBrowser === "attach") {
        const { cdpEndpoint, page } = await runningBrowser(url);
        const recorder = await startRecorder({
          projectDir,
          browser: { attach: { cdpEndpoint } },
        });
        ends.push(() => {
          recorder.end();
          return recorder.done.catch(() => {});
        });
        return {
          recorder,
          page,
          person: await personOn(page),
          projectDir,
          personOn,
        };
      }
      const debugPort = await freePort();
      const recorder = await startRecorder({
        projectDir,
        browser: { launch: { url, headless: true, debugPort } },
      });
      ends.push(() => {
        recorder.end();
        return recorder.done.catch(() => {});
      });
      // The test's own way into the recorder's browser.
      const browser = await chromium.connectOverCDP(
        `http://127.0.0.1:${debugPort}`
      );
      ends.unshift(() => browser.close());
      const page = browser
        .contexts()
        .flatMap((context) => context.pages())
        .find((candidate) => candidate.url() === url);
      if (!page)
        throw new Error(`No page at ${url} in the recorder's browser.`);
      return {
        recorder,
        page,
        person: await personOn(page),
        projectDir,
        personOn,
      };
    });
    for (const end of ends) await end();
    for (const folder of madeInside)
      await rm(folder, { recursive: true, force: true });
  },

  // eslint-disable-next-line no-empty-pattern
  fixturePages: async ({}, use) => {
    const requests: { path: string; userAgent: string }[] = [];
    const server = createServer((request, response) => {
      const path = new URL(request.url ?? "/", "http://fixture").pathname;
      requests.push({ path, userAgent: request.headers["user-agent"] ?? "" });
      readFile(join(fixtureProject, "app", path === "/" ? "index.html" : path))
        .then((page) => {
          response.setHeader("content-type", "text/html; charset=utf-8");
          response.end(page);
        })
        .catch(() => {
          response.statusCode = 404;
          response.end();
        });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve)
    );
    const { port } = server.address() as AddressInfo;
    await use({
      url: (path = "/") => `http://127.0.0.1:${port}${path}`,
      requests,
    });
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  },

  // eslint-disable-next-line no-empty-pattern
  runRecorder: async ({}, use) => {
    const children: ReturnType<typeof spawn>[] = [];
    await use(async (args, { cwd = fixtureProject } = {}) => {
      const debugPort = await freePort();
      const child = spawn(process.execPath, [cliCommand, ...args], {
        cwd,
        env: {
          ...process.env,
          // The tests run where there is no screen.
          AYME_RECORDER_HEADLESS: "1",
          // The test's own way into the recorder's browser.
          AYME_RECORDER_DEBUG_PORT: String(debugPort),
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      children.push(child);
      let stdout = "";
      let stderr = "";
      const waiting: (() => void)[] = [];
      child.stdout!.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
        for (const check of waiting) check();
      });
      child.stderr!.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      const exit = new Promise<{ code: number | null; signal: string | null }>(
        (resolve) =>
          child.on("exit", (code, signal) => {
            resolve({ code, signal });
            for (const check of waiting) check();
          })
      );
      return {
        stdout: () => stdout,
        stderr: () => stderr,
        waitForStdout: (text) =>
          new Promise<void>((resolve, reject) => {
            const check = () => {
              if (stdout.includes(text)) resolve();
              else if (child.exitCode !== null || child.signalCode !== null)
                reject(
                  new Error(
                    `ayme-recorder ended before printing "${text}".\nstdout: ${stdout}\nstderr: ${stderr}`
                  )
                );
            };
            waiting.push(check);
            check();
          }),
        interrupt: () => void child.kill("SIGINT"),
        closePage: async (url) => {
          // The browser's DevTools protocol, over its HTTP endpoints.
          const devtools = `http://127.0.0.1:${debugPort}/json`;
          const targets = (await (await fetch(`${devtools}/list`)).json()) as {
            id: string;
            type: string;
            url: string;
          }[];
          const page = targets.find(
            (target) => target.type === "page" && target.url === url
          );
          if (!page)
            throw new Error(
              `No page at ${url} in the recorder's browser: ${JSON.stringify(targets)}`
            );
          await fetch(`${devtools}/close/${page.id}`);
        },
        exit,
      };
    });
    // A run a failed test left behind takes its browser with it.
    for (const child of children)
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
  },
});
