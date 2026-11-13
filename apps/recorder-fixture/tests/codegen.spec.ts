import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "./fixtures";

test.describe("codegen <url>", () => {
  test("opens the page in Chromium and ends with 'empty' when it is stopped from the terminal", async ({
    fixturePages,
    runRecorder,
  }) => {
    const run = await runRecorder(["codegen", fixturePages.url()]);
    await run.waitForStdout(`Opened ${fixturePages.url()}`);

    expect(fixturePages.requests).toContainEqual({
      path: "/",
      userAgent: expect.stringContaining("Chrome/"),
    });

    run.interrupt();

    expect(await run.exit).toEqual({ code: 0, signal: null });
    expect(run.stdout()).toContain("Nothing was recorded.");
    expect(run.stderr()).toBe("");
  });

  test("ends with 'empty' when the last page is closed", async ({
    fixturePages,
    runRecorder,
  }) => {
    const run = await runRecorder(["codegen", fixturePages.url()]);
    await run.waitForStdout(`Opened ${fixturePages.url()}`);

    await run.closePage(fixturePages.url());

    expect(await run.exit).toEqual({ code: 0, signal: null });
    expect(run.stdout()).toContain("Nothing was recorded.");
    expect(run.stderr()).toBe("");
  });

  test("a second stop from the terminal does no harm", async ({
    fixturePages,
    runRecorder,
  }) => {
    const run = await runRecorder(["codegen", fixturePages.url()]);
    await run.waitForStdout(`Opened ${fixturePages.url()}`);

    run.interrupt();
    run.interrupt();

    expect(await run.exit).toEqual({ code: 0, signal: null });
    expect(run.stdout()).toContain("Nothing was recorded.");
  });

  test("fails with a reason, not a stack trace, in a project with no Playwright installed", async ({
    fixturePages,
    runRecorder,
  }) => {
    // Outside the repository, so no Playwright is installed in it or above
    // it. The command brings none of its own.
    const project = await realpath(
      await mkdtemp(join(tmpdir(), "ayme-recorder-no-playwright-"))
    );
    try {
      const run = await runRecorder(["codegen", fixturePages.url()], {
        cwd: project,
      });

      expect(await run.exit).toEqual({ code: 1, signal: null });
      expect(run.stderr()).toBe(
        `No Playwright is installed in ${project}. The recorder uses the project's own Playwright: install it there, for example with "npm install -D @playwright/test".\n`
      );
      expect(run.stdout()).toBe("");
      expect(fixturePages.requests).toEqual([]);
    } finally {
      await rm(project, { recursive: true });
    }
  });
});
