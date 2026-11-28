import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "@playwright/test";

import { expect, test } from "./aymeCommand";

// `ayme page-objects` and `ayme tools`, run as a child process against a
// real browser: the Session runs the project's Page Objects in Node, on a
// page that contains no ayme.

/** The address `ayme open` printed. */
const addressIn = (stdout: string) =>
  /at (http:\/\/127\.0\.0\.1:\d+)\./.exec(stdout)?.[1];

test("ayme page-objects prints the Page Object Tree of the Tab, between the Tab's line and the tool count", async ({
  ayme,
  baseURL,
}) => {
  expect(await ayme("open", `${baseURL}/shop.html`)).toMatchObject({
    code: 0,
  });

  expect(await ayme("page-objects")).toEqual({
    code: 0,
    stdout: [
      `Tab t1: Shop (${baseURL}/shop.html)`,
      "ShopPage",
      '  heading: heading "Shop" [level=1]',
      "Basket po1",
      "  items: []",
      "This screen has 3 Page Object Tools: ayme -s=default tools lists them with their parameters.",
      "",
    ].join("\n"),
    stderr: "",
  });
});

test("ayme tools lists every Page Object Tool with its parameters, an unavailable one with why, a destructive one marked", async ({
  ayme,
  baseURL,
}) => {
  await ayme("open", `${baseURL}/shop.html`);

  const listed = await ayme("tools");

  expect(listed).toMatchObject({ code: 0, stderr: "" });
  const lines = listed.stdout.trimEnd().split("\n");
  expect(lines[0]).toBe(`Tab t1: Shop (${baseURL}/shop.html)`);
  expect(lines.slice(1).filter((line) => !line.startsWith(" "))).toEqual([
    expect.stringMatching(/^ShopPage\.readHeading: Read the shop's heading\./),
    expect.stringMatching(/^Basket\.add: Put an item in the basket\./),
    expect.stringMatching(
      /^Basket\.clear destructive \(unavailable: The basket is empty\): Clear the basket\./
    ),
  ]);
  const parameters = (tool: string) =>
    JSON.parse(
      lines[lines.findIndex((line) => line.startsWith(tool)) + 1]!.replace(
        /^ {2}parameters: /,
        ""
      )
    ) as { properties: Record<string, unknown>; required?: string[] };
  expect(parameters("Basket.add")).toMatchObject({
    properties: { id: expect.anything(), args: expect.anything() },
    required: expect.arrayContaining(["id"]),
  });
});

test("both listings have a --json form", async ({ ayme, baseURL }) => {
  await ayme("open", `${baseURL}/shop.html`);
  const tab = { id: "t1", url: `${baseURL}/shop.html`, title: "Shop" };

  expect(JSON.parse((await ayme("page-objects", "--json")).stdout)).toEqual({
    ok: true,
    text: expect.stringContaining("Basket po1"),
    data: {
      tab,
      pageObjectTree: expect.stringContaining("Basket po1"),
      tools: 3,
    },
  });
  expect(JSON.parse((await ayme("tools", "--json")).stdout)).toEqual({
    ok: true,
    text: expect.stringContaining("Basket.clear"),
    data: {
      tab,
      tools: [
        expect.objectContaining({
          name: "ShopPage.readHeading",
          available: true,
        }),
        expect.objectContaining({ name: "Basket.add", available: true }),
        expect.objectContaining({
          name: "Basket.clear",
          available: false,
          reason: "The basket is empty",
          destructive: true,
          parameters: expect.objectContaining({ type: "object" }),
        }),
      ],
    },
  });
});

test("ayme puts nothing into the page but through Playwright: the page keeps no script of ayme's", async ({
  ayme,
  baseURL,
}) => {
  const opened = await ayme("open", `${baseURL}/shop.html`);
  await ayme("page-objects");
  const browser = await chromium.connectOverCDP(addressIn(opened.stdout)!);
  try {
    const [page] = browser.contexts()[0]!.pages();

    // A page load drops what ayme evaluated in the page, and ayme adds no
    // script of its own to the document: the one script is Vite's client.
    await page!.reload();

    expect(
      await page!.evaluate(() =>
        [...document.scripts].map((script) => script.src || script.text)
      )
    ).toEqual([`${baseURL}/@vite/client`]);
    expect(await ayme("page-objects")).toMatchObject({
      code: 0,
      stdout: expect.stringContaining("Basket po"),
    });
  } finally {
    await browser.close();
  }
});

test("when the Page Objects do not build, ayme open prints the build error, and no Session or browser is left", async ({
  ayme,
  project,
  processesLeft,
}) => {
  await writeFile(
    join(project, "ayme", "pom", "ShopPage.ts"),
    "export class ShopPage {\n  read( {\n}\n"
  );

  const opened = await ayme("open");

  expect(opened).toMatchObject({ code: 1, stdout: "" });
  expect(opened.stderr).toContain(
    `The Page Objects of ${join(project, "ayme", "page-objects.ts")} did not build:`
  );
  expect(opened.stderr).toContain("ayme/pom/ShopPage.ts:");
  // Neither the Session's process nor Chromium, whose profile is in the
  // same temporary folder.
  await expect.poll(processesLeft).toEqual([]);
  expect(await ayme("page-objects")).toMatchObject({
    code: 1,
    stderr: expect.stringContaining("No Session is open"),
  });
});

/** Makes the project's Page Objects entry one whose top-level await never
 * settles, so its build never finishes loading. */
const neverLoading = (project: string) =>
  writeFile(
    join(project, "ayme", "page-objects.ts"),
    "await new Promise(() => {});\nexport default [];\n"
  );

/** Time for the build to reach the import of the entry, which never ends. */
const intoTheImport = () => new Promise((resolve) => setTimeout(resolve, 1000));

test("ayme close ends a start whose Page Objects never finish loading, and ayme open says so", async ({
  ayme,
  project,
  sessionProcess,
  processesLeft,
}) => {
  await neverLoading(project);

  const opening = ayme("open");
  await expect.poll(sessionProcess).toBeDefined();
  await intoTheImport();

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
  await expect.poll(processesLeft).toEqual([]);
});

test("stopping ayme open ends a start whose Page Objects never finish loading, and leaves no Session or browser", async ({
  ayme,
  aymeUntil,
  project,
  sessionProcess,
  processesLeft,
}) => {
  await neverLoading(project);
  const stop = new AbortController();

  const opening = aymeUntil(stop.signal, "open");
  let answered = false;
  void opening.then(() => (answered = true));
  await expect.poll(sessionProcess).toBeDefined();
  await intoTheImport();
  expect(answered).toBe(false);
  stop.abort();
  await opening;

  await expect.poll(processesLeft).toEqual([]);
  expect(await ayme("page-objects")).toMatchObject({
    code: 1,
    stderr: expect.stringContaining("No Session is open"),
  });
});
