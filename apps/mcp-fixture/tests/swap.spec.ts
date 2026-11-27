import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test } from "./aymeCommand";

// The Swap, run as a child process against a real browser: the test edits a
// Page Object file of its own copy of the project, and the Session builds it
// again and swaps it in between Runs, without a restart.

/** Replaces `from` with `to` in the project's file `file`. */
async function edit(project: string, file: string, from: string, to: string) {
  const path = join(project, "ayme", file);
  const source = await readFile(path, "utf8");
  expect(source).toContain(from);
  await writeFile(path, source.replace(from, to));
}

const BASKET = "pom/Basket.ts";

test("an edited Page Object is swapped in: its rebuilt tools are listed, and it keeps its Page Object Id", async ({
  ayme,
  project,
  baseURL,
}) => {
  await ayme("open", `${baseURL}/shop.html`);
  expect((await ayme("page-objects")).stdout).toContain("Basket po1");

  await edit(
    project,
    BASKET,
    '"Put an item in the basket."',
    '"Add an item to the basket."'
  );

  await expect
    .poll(async () => (await ayme("tools")).stdout)
    .toContain("Basket.add: Add an item to the basket.");
  expect((await ayme("page-objects")).stdout).toContain("Basket po1");
  expect(
    await ayme(
      "call",
      "Basket.add",
      "--params",
      '{"id":"po1","args":{"item":"Milk"}}'
    )
  ).toMatchObject({ code: 0 });
  expect((await ayme("page-objects")).stdout).toContain("listitem: Milk");
});

test("a failed build keeps the Page Objects, and listings say the build is failing until it builds again", async ({
  ayme,
  project,
  baseURL,
}) => {
  await ayme("open", `${baseURL}/shop.html`);
  const tabLine = `Tab: Shop (${baseURL}/shop.html)`;

  await edit(project, BASKET, "async clear() {", "async clear( {");

  await expect
    .poll(async () => (await ayme("tools")).stdout.split("\n")[1])
    .toMatch(/^The Page Objects do not build since the last edit/);
  const tools = await ayme("tools");
  const [tab, building] = tools.stdout.split("\n");
  expect(tab).toBe(tabLine);
  expect(building).toMatch(
    /^The Page Objects do not build since the last edit, so the Session keeps the ones it has: ayme\/pom\/Basket\.ts:\d+:\d+: \S.*$/
  );
  expect(tools.stdout).toContain("Basket.clear");
  const listed = (await ayme("page-objects")).stdout.split("\n");
  expect(listed.slice(0, 3)).toEqual([tabLine, building, "ShopPage"]);

  await edit(project, BASKET, "async clear( {", "async clear() {");

  await expect
    .poll(async () => (await ayme("tools")).stdout.split("\n")[1])
    .toMatch(/^ShopPage\.readHeading/);
});
