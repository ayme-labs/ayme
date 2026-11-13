import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";

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
async function installPlaywrightWithoutChromium(root: string, name: string) {
  const installed = join(root, "node_modules", name);
  await mkdir(installed, { recursive: true });
  await writeFile(
    join(installed, "package.json"),
    JSON.stringify({ name, version: "1.64.0", main: "index.js" })
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
