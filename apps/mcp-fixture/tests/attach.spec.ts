import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium, type BrowserContext, type Page } from "@playwright/test";

import { expect, isAlive, test } from "./aymeCommand";

// `ayme attach`, `ayme detach`, `ayme list` and named Sessions, run as a
// child process against a real browser. The test's own Playwright starts
// the browser and plays the developer's browser automation.

/** A Chromium the browser automation started, with the address of its
 * DevTools protocol, at `url`. */
type Automation = {
  readonly address: string;
  readonly context: BrowserContext;
  readonly page: Page;
};

const cleanups: (() => Promise<void>)[] = [];
test.afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function automationAt(url: string): Promise<Automation> {
  const profile = await mkdtemp(join(tmpdir(), "ayme-automation-"));
  // Port 0: Chromium picks a free one and writes it into the profile.
  const context = await chromium.launchPersistentContext(profile, {
    args: ["--remote-debugging-port=0"],
  });
  cleanups.push(async () => {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  });
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(url);
  const port = (
    await readFile(join(profile, "DevToolsActivePort"), "utf8")
  ).split("\n")[0]!;
  return { address: `http://127.0.0.1:${port}`, context, page };
}

/** An address on this machine that nothing answers on. */
async function silentAddress(): Promise<string> {
  const server = createServer();
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve())
  );
  const { port } = server.address() as AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return `http://127.0.0.1:${port}`;
}

test("ayme attach starts a Session on the automation's browser, and ayme detach ends it and leaves the browser running", async ({
  ayme,
  baseURL,
  sessionProcess,
}) => {
  const { address, context, page } = await automationAt(`${baseURL}/shop.html`);

  expect(await ayme("attach", `--cdp=${address}`)).toEqual({
    code: 0,
    stdout: `A Session started on the browser at ${address}.\nayme -s=default detach ends the Session and leaves the browser running.\n`,
    stderr: "",
  });
  expect((await ayme("page-objects")).stdout).toMatch(
    new RegExp(`^Tab: Shop \\(${baseURL}/shop\\.html\\)\\nShopPage\\n`)
  );
  const background = sessionProcess()!;

  expect(await ayme("detach")).toEqual({
    code: 0,
    stdout: "The Session ended. Its browser keeps running.\n",
    stderr: "",
  });
  await expect.poll(() => isAlive(background)).toBe(false);
  expect(context.pages()).toEqual([page]);
  expect(await page.title()).toBe("Shop");
});

test("ayme close on a joined browser ends the Session and leaves the browser running", async ({
  ayme,
  baseURL,
  sessionProcess,
}) => {
  const { address, page } = await automationAt(`${baseURL}/plain.html`);
  await ayme("attach", `--cdp=${address}`);
  const background = sessionProcess()!;

  expect(await ayme("close")).toEqual({
    code: 0,
    stdout: "The Session ended. Its browser keeps running.\n",
    stderr: "",
  });
  await expect.poll(() => isAlive(background)).toBe(false);
  expect(page.url()).toBe(`${baseURL}/plain.html`);
  expect(await page.evaluate(() => document.readyState)).toBe("complete");
});

test("ayme leaves a dialog the automation's page opens after the join for the automation to answer", async ({
  ayme,
  baseURL,
}) => {
  const { address, page } = await automationAt(`${baseURL}/plain.html`);
  expect(await ayme("attach", `--cdp=${address}`)).toMatchObject({ code: 0 });
  // The automation's own listener: without one, its Playwright would
  // dismiss the dialog itself.
  const dialog = page.waitForEvent("dialog");
  const confirmed = page.evaluate(() => confirm("Leave the page?"));

  const shown = await dialog;
  // ayme had the time to answer it, had it answered dialogs.
  await new Promise((resolve) => setTimeout(resolve, 500));
  await shown.accept();

  expect(await confirmed).toBe(true);
  expect(await ayme("detach")).toMatchObject({ code: 0 });
});

test("a joined Session ends when the automation closes its browser", async ({
  ayme,
  baseURL,
  sessionProcess,
}) => {
  const { address, context } = await automationAt(`${baseURL}/plain.html`);
  await ayme("attach", `--cdp=${address}`);
  const background = sessionProcess()!;

  await context.close();

  await expect.poll(() => isAlive(background)).toBe(false);
});

test("ayme attach to an address nothing answers on says so, and starts no Session", async ({
  ayme,
}) => {
  const address = await silentAddress();

  const attached = await ayme("attach", `--cdp=${address}`);

  expect(attached).toMatchObject({
    code: 1,
    stdout: "",
    stderr: expect.stringContaining(
      `Playwright could not connect to the browser at ${address}.`
    ),
  });
  expect(await ayme("list")).toMatchObject({
    stdout: expect.stringMatching(/^No Session is open in /),
  });
});

test("ayme detach on a browser ayme opened is refused with a pointer to ayme close, and the Session goes on", async ({
  ayme,
}) => {
  await ayme("open");

  expect(await ayme("detach")).toEqual({
    code: 1,
    stdout: "",
    stderr:
      "ayme opened this Session's browser, so ayme detach would leave it without an owner. End the Session and close the browser with ayme -s=default close.\n",
  });
  expect(await ayme("close")).toMatchObject({
    code: 0,
    stdout: "The Session ended and its browser was closed.\n",
  });
});

test("a folder has a Session of each name, ayme list shows them, and -s picks the one a command reaches", async ({
  ayme,
  project,
}) => {
  expect(await ayme("-s=one", "open")).toMatchObject({ code: 0 });
  expect(await ayme("open", "-s", "two")).toMatchObject({ code: 0 });

  expect(await ayme("list")).toMatchObject({
    code: 0,
    stdout: expect.stringMatching(
      new RegExp(
        `^Sessions in ${project}:\\none, in process \\d+\\ntwo, in process \\d+\\n$`
      )
    ),
  });
  expect(await ayme("close")).toMatchObject({
    code: 1,
    stderr: `No Session is open in ${project}. Start one with ayme open.\n`,
  });
  // Its hint names the Session it refused for, so that run as printed it
  // reaches that one and not the default.
  expect(await ayme("-s=one", "detach")).toMatchObject({
    code: 1,
    stderr: expect.stringMatching(/with ayme -s=one close\.\n$/),
  });
  expect(await ayme("-s=one", "close")).toMatchObject({ code: 0 });
  expect(await ayme("list")).toMatchObject({
    stdout: expect.stringMatching(/:\ntwo, in process \d+\n$/),
  });
  expect(await ayme("-s=two", "close")).toMatchObject({ code: 0 });
});

test("two ayme open of one name at the same moment: one starts and the other is refused", async ({
  ayme,
  project,
}) => {
  const answers = await Promise.all([
    ayme("-s=same", "open"),
    ayme("-s=same", "open"),
  ]);

  expect(answers.map(({ code }) => code).sort()).toEqual([0, 1]);
  expect(answers.find(({ code }) => code === 1)!.stderr).toMatch(
    new RegExp(
      `^A Session named same is already open in ${project}, in process \\d+\\. End it with ayme -s=same close first\\.\\n$`
    )
  );
  expect(await ayme("-s=same", "close")).toMatchObject({ code: 0 });
});
