import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";

import range from "../playwright-range.json";
import { RecorderStartError, startRecorder } from "./index";

// Outside the repository, so no Playwright resolves from it: the engine
// never falls back to one of its own.
let folder: string;
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "ayme-recorder-project-"));
});
afterEach(() => rm(folder, { recursive: true }));

const start = (projectDir: string, launch: { debugPort?: number } = {}) =>
  startRecorder({
    projectDir,
    browser: { launch: { url: "about:blank", ...launch } },
  }).catch((error: unknown) => error);

/** Installs a stand-in for Playwright whose Chromium never launches, and
 * says what it was asked to launch with. */
async function installPlaywrightWithoutChromium(
  root: string,
  name: string,
  version = "1.64.0"
) {
  const installed = join(root, "node_modules", name);
  await mkdir(installed, { recursive: true });
  await writeFile(
    join(installed, "package.json"),
    JSON.stringify({ name, version, main: "index.js" })
  );
  await writeFile(
    join(installed, "index.js"),
    `exports.chromium = { launch: async (options) => { throw new Error("Cannot launch with " + JSON.stringify(options)); } };\n`
  );
}

it("fails to start, with a reason, when the project has no Playwright installed", async () => {
  const failure = await start(folder);

  expect(failure).toBeInstanceOf(RecorderStartError);
  expect(failure).toMatchObject({
    reason: "playwright-not-found",
    message: expect.stringContaining(folder),
  });
});

it.each(["playwright", "@playwright/test", "playwright-core"])(
  "fails to start, with a reason, when the project's %s cannot launch Chromium",
  async (name) => {
    await installPlaywrightWithoutChromium(folder, name);

    const failure = await start(folder);

    expect(failure).toBeInstanceOf(RecorderStartError);
    expect(failure).toMatchObject({
      reason: "browser-unavailable",
      message: expect.stringMatching(
        /^Playwright could not open Chromium\. Cannot launch with /
      ),
    });
  }
);

it("fails to start, naming the supported range, when the project's Playwright is older than it", async () => {
  await installPlaywrightWithoutChromium(folder, "@playwright/test", "1.61.1");

  const failure = await start(folder);

  expect(failure).toBeInstanceOf(RecorderStartError);
  expect(failure).toMatchObject({
    reason: "playwright-too-old",
    message: `${folder} has Playwright 1.61.1. The recorder needs Playwright ${range.floor} or newer, and is verified on ${range.floor} to ${range.lastVerified}: update the project's Playwright, for example with "npm install -D @playwright/test@latest".`,
  });
});

/** What the project's Playwright was asked to launch Chromium with. */
async function launchOptions(launch: { debugPort?: number } = {}) {
  await installPlaywrightWithoutChromium(folder, "playwright");
  const { message } = (await start(folder, launch)) as RecorderStartError;
  return JSON.parse(message.slice(message.indexOf("{"))) as unknown;
}

it("launches Chromium with a window, and leaves the terminal's signals to its caller", async () => {
  expect(await launchOptions()).toEqual({
    headless: false,
    args: [],
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  });
});

it("opens the browser's DevTools protocol on the debug port it is given", async () => {
  expect(await launchOptions({ debugPort: 9333 })).toMatchObject({
    args: ["--remote-debugging-port=9333"],
  });
});

it("uses the Playwright installed above the project folder, as in a monorepo", async () => {
  await installPlaywrightWithoutChromium(folder, "playwright");
  const projectDir = join(folder, "packages", "app");
  await mkdir(projectDir, { recursive: true });

  expect(await start(projectDir)).toMatchObject({
    reason: "browser-unavailable",
  });
});

/**
 * Installs a stand-in for Playwright whose Chromium opens one page that can
 * never be read: a snapshot of it never comes. `control.holdClick()` plays
 * the page holding a click back.
 */
async function installPlaywrightWithUnreadablePage(root: string) {
  const installed = join(root, "node_modules", "playwright");
  await mkdir(installed, { recursive: true });
  await writeFile(
    join(installed, "package.json"),
    JSON.stringify({ name: "playwright", version: "1.64.0", main: "index.js" })
  );
  await writeFile(
    join(installed, "index.js"),
    `
const emitter = (target) => {
  const listeners = {};
  target.on = (event, listener) => void (listeners[event] ??= []).push(listener);
  target.emit = (event, value) => (listeners[event] ?? []).forEach((listener) => listener(value));
  return target;
};
exports.control = {};
exports.chromium = {
  launch: async () => {
    const browser = emitter({ close: async () => {} });
    browser.newContext = async () => {
      const context = emitter({});
      const frame = { evaluate: async () => undefined, url: () => "http://stand-in.test/" };
      const page = emitter({
        goto: async () => {},
        url: () => "http://stand-in.test/",
        mainFrame: () => frame,
        frames: () => [frame],
        ariaSnapshot: () => new Promise(() => {}),
      });
      context.pages = () => [page];
      context.addInitScript = async () => {};
      context.exposeBinding = async (name, held) => {
        if (name === "__aymeRecorderHeld")
          exports.control.holdClick = () =>
            held({ page, frame }, { x: 1, y: 1, detail: 1, modifiers: [] });
      };
      context._startRecording = async () => {};
      context.newPage = async () => {
        context.emit("page", page);
        return page;
      };
      return context;
    };
    return browser;
  },
};
`
  );
  return (
    createRequire(import.meta.url)(installed) as {
      control: { holdClick(): void };
    }
  ).control;
}

// The stock adapter itself, on a page that never answers: the recorder must
// not wait on the browser. The wrap-up's time limit is real time here.
it(
  "takes Finish while the page cannot be read, and ends when the wrap-up time limit has passed",
  { timeout: 20_000 },
  async () => {
    const control = await installPlaywrightWithUnreadablePage(folder);
    const recorder = await startRecorder({
      projectDir: folder,
      browser: { launch: { url: "http://stand-in.test/" } },
    });
    const phases: string[] = [];
    recorder.subscribe(({ state }) => {
      // A phase is told again with each entry: once is enough here.
      if (phases.at(-1) !== state.phase) phases.push(state.phase);
    });
    await expect(recorder.send({ type: "record" })).resolves.toBe("applied");
    // Its "before" snapshot is asked for, and never comes.
    control.holdClick();

    await expect(recorder.send({ type: "finish" })).resolves.toBe("applied");
    expect(phases).toEqual(["notRecording", "recording", "wrappingUp"]);

    await expect(recorder.done).resolves.toEqual({ kind: "empty" });
  }
);
