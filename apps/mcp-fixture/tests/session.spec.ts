import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type RequestListener } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium, type Browser } from "@playwright/test";

import { expect, isAlive, test } from "./aymeCommand";

// The `ayme` command's Session commands, run as a child process against a
// real browser. The test's own Playwright connection plays the developer's
// browser automation.

/** The address `ayme open` printed. */
const addressIn = (stdout: string) =>
  /at (http:\/\/127\.0\.0\.1:\d+)\./.exec(stdout)?.[1];

/** Connects to the browser at `address` as the browser automation does. */
const automation = (address: string): Promise<Browser> =>
  chromium.connectOverCDP(address);

const disconnected = (browser: Browser) =>
  new Promise<void>((resolve) => browser.on("disconnected", () => resolve()));

/** A server that answers each request with `listener`, at the address it
 * resolves with, until the test ends. */
async function serving(listener: RequestListener): Promise<string> {
  const server = createServer(listener);
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve())
  );
  const sockets = new Set<Socket>();
  server.on("connection", (socket) => sockets.add(socket));
  cleanups.push(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
}

/** The title of the browser's page, as its DevTools protocol lists it. */
async function pageTitle(address: string): Promise<string> {
  const targets = (await (await fetch(`${address}/json/list`)).json()) as {
    type: string;
    title: string;
  }[];
  return targets.find(({ type }) => type === "page")!.title;
}

const cleanups: (() => Promise<void>)[] = [];
test.afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

test("ayme open <url> starts a browser at the page and prints its address; ayme close ends the Session and closes the browser", async ({
  ayme,
  baseURL,
  sessionProcess,
}) => {
  const opened = await ayme("open", `${baseURL}/plain.html`);

  expect(opened).toMatchObject({ code: 0, stderr: "" });
  const address = addressIn(opened.stdout);
  expect(address).toBeDefined();
  const browser = await automation(address!);
  expect(
    browser
      .contexts()
      .flatMap((context) => context.pages().map((page) => page.url()))
  ).toEqual([`${baseURL}/plain.html`]);
  const gone = disconnected(browser);
  const background = sessionProcess()!;

  expect(await ayme("close")).toEqual({
    code: 0,
    stdout: "The Session ended and its browser was closed.\n",
    stderr: "",
  });
  await gone;
  await expect.poll(() => isAlive(background)).toBe(false);
});

test("--json prints each answer as JSON", async ({ ayme }) => {
  const opened = await ayme("open", "--json");

  expect(opened.code).toBe(0);
  const answer = JSON.parse(opened.stdout) as { data: { address: string } };
  expect(answer).toEqual({
    ok: true,
    text: expect.stringContaining(answer.data.address),
    data: { address: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+$/) },
  });
  expect(JSON.parse((await ayme("close", "--json")).stdout)).toEqual({
    ok: true,
    text: "The Session ended and its browser was closed.",
  });
});

test("a command without a Session says so on stderr, and exits with 1", async ({
  ayme,
  project,
}) => {
  const text = `No Session is open in ${project}. Start one with ayme -s=default open.`;

  expect(await ayme("close")).toEqual({
    code: 1,
    stdout: "",
    stderr: `${text}\n`,
  });
  expect(await ayme("close", "--json")).toEqual({
    code: 1,
    stdout: "",
    stderr: `${JSON.stringify({ ok: false, text })}\n`,
  });
});

test("a second ayme open in a folder with a Session is refused", async ({
  ayme,
  project,
  sessionProcess,
}) => {
  await ayme("open");

  expect(await ayme("open")).toEqual({
    code: 1,
    stdout: "",
    stderr: `A Session is already open in ${project}, in process ${sessionProcess()}. End it with ayme -s=default close first.\n`,
  });
});

test("when the browser goes away, the Session ends and leaves no process behind", async ({
  ayme,
  sessionProcess,
}) => {
  const browser = await automation(addressIn((await ayme("open")).stdout)!);
  const background = sessionProcess()!;

  // The browser automation closes the browser itself.
  const session = await browser.newBrowserCDPSession();
  await session.send("Browser.close").catch(() => {});

  await expect.poll(() => isAlive(background)).toBe(false);
  expect(await ayme("close")).toMatchObject({
    code: 1,
    stderr: expect.stringContaining("No Session is open"),
  });
});

test("ayme leaves a dialog open for the browser automation to answer", async ({
  ayme,
  baseURL,
}) => {
  const opened = await ayme("open", `${baseURL}/plain.html`);
  const browser = await automation(addressIn(opened.stdout)!);
  const [page] = browser.contexts()[0]!.pages();
  // The automation's own listener: without one, its Playwright would
  // dismiss the dialog itself.
  const dialog = page!.waitForEvent("dialog");
  const confirmed = page!.evaluate(() => confirm("Leave the page?"));

  const shown = await dialog;
  // ayme had the time to answer it, had it answered dialogs.
  await new Promise((resolve) => setTimeout(resolve, 500));
  await shown.accept();

  expect(await confirmed).toBe(true);
  await browser.close();
});

test("a dialog the first page opens while it loads holds up neither ayme open nor ayme close, and ayme leaves it open", async ({
  ayme,
}) => {
  const url = await serving((_, response) => {
    response.setHeader("content-type", "text/html");
    response.end(
      '<title>Asking</title><script>document.title = confirm("Leave the page?") ? "accepted" : "dismissed";</script>'
    );
  });

  const opened = await ayme("open", url);

  expect(opened).toMatchObject({ code: 0, stderr: "" });
  const address = addressIn(opened.stdout)!;
  await expect.poll(() => pageTitle(address)).toBe("Asking");
  // ayme had the time to answer the dialog, had it answered dialogs.
  await new Promise((resolve) => setTimeout(resolve, 500));
  expect(await pageTitle(address)).toBe("Asking");
  expect(await ayme("close")).toMatchObject({ code: 0, stderr: "" });
});

test("a start that fails is answered with why, however soon its process ends", async ({
  aymeIn,
}) => {
  // A project without Playwright, outside the fixture.
  const elsewhere = await mkdtemp(join(tmpdir(), "ayme-no-playwright-"));
  try {
    const opened = await aymeIn(elsewhere, "open");

    expect(opened).toMatchObject({
      code: 1,
      stdout: "",
      stderr: expect.stringContaining("ayme uses the project's own Playwright"),
    });
  } finally {
    await rm(elsewhere, { recursive: true, force: true });
  }
});

test("ayme close sent while a start waits on a page that never answers ends the start, and ayme open says so", async ({
  ayme,
  sessionProcess,
}) => {
  const url = await serving(() => {});

  const opening = ayme("open", url);
  await expect.poll(sessionProcess).toBeDefined();
  const background = sessionProcess()!;

  expect(await ayme("close")).toEqual({
    code: 0,
    stdout: "The Session ended and its browser was closed.\n",
    stderr: "",
  });
  expect(await opening).toEqual({
    code: 1,
    stdout: "",
    stderr: "ayme close ended the Session before it started.\n",
  });
  await expect.poll(() => isAlive(background)).toBe(false);
});
