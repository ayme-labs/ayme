import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Page } from "@playwright/test";

import { expect, test } from "./aymeCommand";

// `ayme call`, run as a child process against a real browser: a Run of the
// project's Page Objects in Node, on a page that contains no ayme. The
// test's own Playwright connection plays the developer's browser automation.

/** The address `ayme open` printed. */
const addressIn = (stdout: string) =>
  /at (http:\/\/127\.0\.0\.1:\d+)\./.exec(stdout)?.[1];

/** The page of the Session's browser, as the browser automation reaches
 * it; the connection closes with the test. */
async function automationPage(stdout: string): Promise<Page> {
  const browser = await chromium.connectOverCDP(addressIn(stdout)!);
  cleanups.push(() => browser.close());
  return browser.contexts()[0]!.pages()[0]!;
}

const cleanups: (() => Promise<void>)[] = [];
test.afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

/** Whether `promise` is still pending after `ms`. */
async function stillPending(promise: Promise<unknown>, ms = 1_000) {
  let settled = false;
  void promise.then(() => (settled = true));
  await new Promise((resolve) => setTimeout(resolve, ms));
  return !settled;
}

test("ayme call runs a Page Object Tool and prints the short answer: what the action returned and how the Page Object Tree changed", async ({
  ayme,
  baseURL,
  project,
}) => {
  await ayme("open", `${baseURL}/shop.html`);

  expect(
    await ayme(
      "call",
      "Basket.add",
      "--params",
      '{"id": "po1", "args": {"item": "Milk"}}'
    )
  ).toEqual({
    code: 0,
    stdout: [
      "settled: true",
      "changes:",
      "Basket po1",
      "  items:",
      "    + - listitem: Milk",
      "",
    ].join("\n"),
    stderr: "",
  });
  // A tool of a Page Object without a root takes its action's own
  // parameters, here none.
  expect(await ayme("call", "ShopPage.readHeading")).toEqual({
    code: 0,
    stdout: 'settled: true\nresult: "Shop"\n',
    stderr: "",
  });

  await writeFile(join(project, "clear.json"), '{"id": "po1"}');
  expect(
    JSON.parse(
      (await ayme("call", "Basket.clear", "--params", "@clear.json", "--json"))
        .stdout
    )
  ).toEqual({
    ok: true,
    text: expect.stringContaining("settled: true"),
    data: {
      settled: true,
      changes: expect.stringContaining("- listitem: Milk"),
    },
  });
});

test("an unknown tool, an unknown id and invalid parameters are each answered on stderr with exit code 1, and no Run starts", async ({
  ayme,
  baseURL,
}) => {
  await ayme("open", `${baseURL}/shop.html`);
  const refused = (stderr: string) => ({ code: 1, stdout: "", stderr });

  expect(await ayme("call", "Basket.empty")).toEqual(
    refused('RuntimeStateError: There is no tool "Basket.empty".\n')
  );
  // A tool of the Session's Host that is no Page Object Tool is none.
  expect(await ayme("call", "page_objects")).toEqual(
    refused('RuntimeStateError: There is no tool "page_objects".\n')
  );
  expect(
    await ayme(
      "call",
      "Basket.add",
      "--params",
      '{"id": "po9", "args": {"item": "Milk"}}'
    )
  ).toEqual(
    refused(
      'RefResolutionError: Cannot call Basket.add on Page Object "po9": it is not on the page.\n'
    )
  );
  expect(
    await ayme("call", "Basket.add", "--params", '{"args": {"item": "Milk"}}')
  ).toEqual(refused("ToolInputError: Input property id is required.\n"));
  expect(await ayme("call", "Basket.add", "--params", "{id: po1}")).toEqual({
    code: 1,
    stdout: "",
    stderr: expect.stringMatching(/^--params is not JSON: /),
  });
  expect(await ayme("page-objects")).toMatchObject({
    stdout: expect.stringContaining("Basket po1\n  items: []\n"),
  });
});

test("after an action that loads another document, the answer comes from the new page once the Page Object it returned is there", async ({
  ayme,
  baseURL,
}) => {
  await ayme("open", `${baseURL}/sign-in.html`);

  const signedIn = await ayme(
    "call",
    "SignInPage.signIn",
    "--params",
    '{"name": "Ada"}'
  );

  expect(signedIn).toMatchObject({ code: 0, stderr: "" });
  expect(signedIn.stdout.split("\n").slice(0, 2)).toEqual([
    "settled: false",
    `url: ${baseURL}/account.html?name=Ada`,
  ]);
  expect(signedIn.stdout).toContain("- SignInPage (removed)");
  expect(signedIn.stdout).toContain(
    '+ AccountPage\n    heading: heading "Account" [level=1]'
  );
});

test("an error thrown by Page Object code ends only its Run, and the Session catches what nothing else caught", async ({
  ayme,
  baseURL,
}) => {
  await ayme("open", `${baseURL}/account.html`);

  expect(await ayme("call", "AccountPage.fail")).toEqual({
    code: 1,
    stdout: "",
    stderr: "The account is locked.\n",
  });
  expect(await ayme("call", "AccountPage.leaveUncaught")).toMatchObject({
    code: 0,
  });
  // The uncaught error and rejection fire once the Run has answered.
  await new Promise((resolve) => setTimeout(resolve, 500));

  expect(await ayme("call", "ShopPage.readHeading")).toEqual({
    code: 0,
    stdout: 'settled: true\nresult: "Account"\n',
    stderr: "",
  });
});

test("one Run per Tab at a time: a call and a listing wait for the Run under way, which ayme gives no time limit", async ({
  ayme,
  baseURL,
}) => {
  const opened = await ayme("open", `${baseURL}/account.html`);
  const page = await automationPage(opened.stdout);

  const waiting = ayme("call", "AccountPage.waitForRelease");
  expect(await stillPending(waiting)).toBe(true);
  const reading = ayme("call", "ShopPage.readHeading");
  const listing = ayme("tools");
  expect(await stillPending(Promise.race([reading, listing]))).toBe(true);

  await page.evaluate(() => Object.assign(window, { released: true }));

  expect(await waiting).toMatchObject({ code: 0, stdout: "settled: true\n" });
  expect(await reading).toMatchObject({ code: 0 });
  expect(await listing).toMatchObject({
    code: 0,
    stdout: expect.stringContaining("AccountPage.waitForRelease"),
  });
});

test("ayme close does not wait for a Run: the Run's command is answered that the Session was closed", async ({
  ayme,
  baseURL,
}) => {
  await ayme("open", `${baseURL}/account.html`);
  const waiting = ayme("call", "AccountPage.waitForRelease");
  expect(await stillPending(waiting)).toBe(true);

  expect(await ayme("close")).toMatchObject({ code: 0 });

  expect(await waiting).toEqual({
    code: 1,
    stdout: "",
    stderr: "The Session was closed before it answered this command.\n",
  });
  expect(await ayme("page-objects")).toMatchObject({
    code: 1,
    stderr: expect.stringContaining("No Session is open"),
  });
});
