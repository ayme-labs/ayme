import { elementOfRef } from "../../test-utils/elementRefs.testSupport";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createPage } from "./browserPage";
import { listRegisteredPomTargets, registerCompiledPom } from "./registry";
import {
  startSession,
  type TestSession,
} from "../../test-utils/session.testSupport";

// What every consumer of the registry's targets reads of declared Locator
// children, on a real page: each element of a Locator collection at its
// index, as a Page Object collection's items are; a single Locator child,
// or one whose manifest leaves its cardinality out, at its own path.

describe("registered Locator children's targets in Chromium", () => {
  let page: ReturnType<typeof createPage>;
  let session: TestSession;
  beforeEach(() => {
    page = createPage();
    session = startSession(page);
  });
  afterEach(() => {
    session.stop();
    document.body.innerHTML = "";
  });

  it("indexes each element of a Locator collection, names it by its nth locator, and leaves single Locator children at their paths", async () => {
    document.body.innerHTML = `
      <main>
        <h1>Runs</h1>
        <table><tr><td>first</td></tr><tr><td>second</td></tr></table>
        <p class="hint">Pick a run.</p>
      </main>
    `;
    class RunsTable {
      readonly heading = page.locator("h1");
      readonly rows = page.locator("tr");
      readonly hint = page.locator(".hint");
    }
    registerCompiledPom(RunsTable, {
      className: "RunsTable",
      tools: [],
      members: [
        {
          memberName: "heading",
          kind: "locator",
          access: "field",
          collection: false,
        },
        {
          memberName: "rows",
          kind: "locator",
          access: "field",
          collection: true,
          description: "One row per run.",
        },
        { memberName: "hint", kind: "locator", access: "field" },
      ],
      components: [],
    });
    session.register(RunsTable);

    const targets = await listRegisteredPomTargets();

    expect(
      await Promise.all(
        targets.map(async ({ path, ref, locator }) => ({
          path,
          text: (await elementOfRef(ref))?.textContent,
          locator,
        }))
      )
    ).toEqual([
      { path: "RunsTable.heading", text: "Runs", locator: "locator('h1')" },
      {
        path: "RunsTable.rows[0]",
        text: "first",
        locator: "locator('tr').first()",
      },
      {
        path: "RunsTable.rows[1]",
        text: "second",
        locator: "locator('tr').nth(1)",
      },
      {
        path: "RunsTable.hint",
        text: "Pick a run.",
        locator: "locator('.hint')",
      },
    ]);
  });

  it("names the last element of a Locator collection by its last() locator too, and the one element of a collection that holds one by the collection's locator, as Interactions on them name them", async () => {
    document.body.innerHTML = `
      <table><tr><td>only</td></tr></table>
      <ul><li>first</li><li>second</li></ul>
    `;
    class RunsTable {
      readonly rows = page.locator("tr");
      readonly items = page.locator("li");
    }
    registerCompiledPom(RunsTable, {
      className: "RunsTable",
      tools: [],
      members: ["rows", "items"].map((memberName) => ({
        memberName,
        kind: "locator",
        access: "field",
        collection: true,
      })),
      components: [],
    });
    session.register(RunsTable);

    const targets = await listRegisteredPomTargets();

    expect(
      targets.map(({ path, locator, aliases }) => ({ path, locator, aliases }))
    ).toStrictEqual([
      {
        path: "RunsTable.rows[0]",
        locator: "locator('tr').first()",
        aliases: ["locator('tr')", "locator('tr').last()"],
      },
      {
        path: "RunsTable.items[0]",
        locator: "locator('li').first()",
        aliases: [],
      },
      {
        path: "RunsTable.items[1]",
        locator: "locator('li').nth(1)",
        aliases: ["locator('li').last()"],
      },
    ]);
  });
});
