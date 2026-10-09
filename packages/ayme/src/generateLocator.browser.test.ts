import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveLocatorElements } from "@ayme-dev/playwright-lite/internal";
import type { Locator, Page } from "@playwright/test";

import { createPage } from "./browserPage";
import type { PomManifest } from "./contracts";
import { RuntimeStateError, ToolInputError } from "./errors";
import { buildToolOptions } from "./goalLoopQuestions";
import { getInteractionHistory } from "./pageState";
import { shapeOf } from "./playwrightMcp.testSupport";
import { registerCompiledPom } from "./registry";
import { createAyme, type Ayme } from "./runtime";
import type { ToolInput, ToolResult } from "./toolTypes";
import { synchronizeWebMcpTools } from "./webMcp";

type Result = ToolResult<"generate_locator">;

const FIXTURE = `
  <h1>Orders</h1>
  <ul>
    <li id="row-1" aria-label="Order 1"><span>Order 1</span><button>Delete</button></li>
    <li id="row-2" aria-label="Order 2"><span>Order 2</span><button>Delete</button></li>
  </ul>
  <div id="dialog" role="dialog" aria-label="Archive order">
    <button>Cancel</button>
    <button>Confirm archive</button>
  </div>
  <button id="settings" aria-label="Settings"><span id="icon">⚙</span></button>
  <button data-qa="submit-order">Submit</button>
  <div id="account" role="none"><button>Save changes</button></div>
  <button class="twin">Twin</button>
  <button class="twin">Twin</button>
  <button id="gone">Gone</button>
`;

/** A page whose account component has a root without a ref, so `snapshot` shows it as `s_…`. */
class AccountPage {
  readonly account;
  constructor(page: Page) {
    this.account = { root: page.locator("#account") };
  }
}

const accountManifest: PomManifest = {
  className: "AccountPage",
  members: [
    {
      memberName: "account",
      kind: "component",
      access: "field",
      componentClassName: "Account",
      collection: false,
    },
  ],
  tools: [],
  components: [
    {
      className: "Account",
      members: [{ memberName: "root", kind: "locator", access: "field" }],
      tools: [],
    },
  ],
};
registerCompiledPom(AccountPage, accountManifest);

/** Build a locator string on `scope`, as page object code would. */
function elementsOf(scope: Page | Locator, locator: string): Element[] {
  const build = new Function("scope", `return scope.${locator};`) as (
    scope: Page | Locator
  ) => Locator;
  return resolveLocatorElements(build(scope));
}

const element = (selector: string) => document.querySelector(selector)!;

describe("generate_locator in Chromium", () => {
  let page: Page;
  let ayme: Ayme;
  let stop: () => void;
  let dispose: () => void;
  let published: (input: unknown) => Promise<unknown>;

  beforeEach(async () => {
    document.body.innerHTML = FIXTURE;
    page = createPage({ actionTimeout: 500, testIdAttribute: "data-qa" });
    ayme = createAyme({ pageFactory: () => page });
    stop = ayme.start();
    ayme.pom.register(AccountPage);
    const tools = new Map<string, (input: unknown) => Promise<unknown>>();
    const publication = await synchronizeWebMcpTools({
      async registerTool(tool: {
        name: string;
        execute(input: unknown): Promise<unknown>;
      }) {
        tools.set(tool.name, (input) => tool.execute(input));
      },
    } as never);
    dispose = publication.dispose;
    published = tools.get("generate_locator")!;
  });

  afterEach(() => {
    dispose();
    stop();
    document.body.innerHTML = "";
  });

  /** The synthetic ref `snapshot` gives AccountPage's root. */
  async function accountRootRef() {
    const { structure } = await ayme.tools.run("snapshot", {});
    const found = structure.match(/(s_\w+) AccountPage\.account\b/)?.[1];
    if (!found) throw new Error("Expected a synthetic ref for AccountPage.");
    return found;
  }

  /** The ref `snapshot` gives the node with this role and name. */
  async function ref(role: string, name: string) {
    const { structure } = await ayme.tools.run("snapshot", {});
    const found = structure.match(new RegExp(`(e\\d+) ${role} "${name}"`))?.[1];
    if (!found) throw new Error(`Expected a ref for ${role} "${name}".`);
    return found;
  }

  /** The ref of the row's own Delete button: the first button after the row. */
  async function deleteRefIn(row: string) {
    const { structure } = await ayme.tools.run("snapshot", {});
    const lines = structure.split("\n");
    const start = lines.findIndex((line) => line.includes(`listitem "${row}"`));
    const found = lines
      .slice(start)
      .join("\n")
      .match(/(e\d+) button "Delete"/)?.[1];
    if (!found) throw new Error(`Expected a Delete button in ${row}.`);
    return found;
  }

  const run = (input: ToolInput<"generate_locator">) =>
    ayme.tools.run("generate_locator", input);

  /** The locator of one entry, failing the test with its error otherwise. */
  function locatorAt(result: Result, group: number, entry: number) {
    const found = result.groups[group]!;
    if ("error" in found) throw new Error(found.error);
    const at = found.locators[entry]!;
    if ("error" in at) throw new Error(at.error);
    return at.locator;
  }

  function errorAt(result: Result, group: number, entry: number) {
    const found = result.groups[group]!;
    if ("error" in found) throw new Error(found.error);
    const at = found.locators[entry]!;
    if (!("error" in at)) throw new Error(`Expected an error: ${at.locator}`);
    return at.error;
  }

  it("is published with the Browser Tools and takes groups of targets", async () => {
    const info = ayme.tools
      .list()
      .find(({ name }) => name === "generate_locator");
    expect(info?.group).toBe("browser");
    expect(shapeOf(info?.inputSchema)).toEqual({
      type: "object",
      properties: {
        groups: {
          type: "array",
          items: {
            type: "object",
            properties: {
              targets: { type: "array", items: { type: "string" } },
              within: { type: "string" },
            },
            required: ["targets"],
          },
        },
      },
      required: ["groups"],
    });
    expect(info?.description).toMatch(/capture-scoped/);
  });

  it("returns a page-level role and name locator that matches exactly the element", async () => {
    const heading = await ref("heading", "Orders");
    const result = await run({ groups: [{ targets: [heading] }] });

    expect(result).toEqual({
      groups: [
        {
          locators: [
            {
              target: heading,
              locator: "getByRole('heading', { name: 'Orders' })",
            },
          ],
        },
      ],
    });
    expect(elementsOf(page, locatorAt(result, 0, 0))).toEqual([element("h1")]);
  });

  it("returns locators relative to each group's container, in input order, and accepts a ref in two groups", async () => {
    const row = await ref("listitem", "Order 2");
    const dialog = await ref("dialog", "Archive order");
    const deleteInRow = await deleteRefIn("Order 2");
    const confirm = await ref("button", "Confirm archive");
    const cancel = await ref("button", "Cancel");
    const heading = await ref("heading", "Orders");

    const result = await run({
      groups: [
        { targets: [deleteInRow], within: row },
        { targets: [confirm, cancel], within: dialog },
        { targets: [heading, deleteInRow] },
      ],
    });

    expect(result.groups.map((group) => group.within)).toEqual([
      row,
      dialog,
      undefined,
    ]);
    expect(
      result.groups.map((group) =>
        "locators" in group ? group.locators.map(({ target }) => target) : []
      )
    ).toEqual([[deleteInRow], [confirm, cancel], [heading, deleteInRow]]);

    const rowButton = element("#row-2 button");
    const relative = locatorAt(result, 0, 0);
    expect(relative).toBe("getByRole('button', { name: 'Delete' })");
    expect(elementsOf(page.locator("#row-2"), relative)).toEqual([rowButton]);

    const [cancelButton, confirmButton] =
      document.querySelectorAll("#dialog button");
    expect(
      elementsOf(page.locator("#dialog"), locatorAt(result, 1, 0))
    ).toEqual([confirmButton]);
    expect(
      elementsOf(page.locator("#dialog"), locatorAt(result, 1, 1))
    ).toEqual([cancelButton]);

    const pageLevel = locatorAt(result, 2, 1);
    expect(pageLevel).not.toBe(relative);
    expect(elementsOf(page, pageLevel)).toEqual([rowButton]);
  });

  it("returns a container-relative locator where the page-level one needs .nth()", async () => {
    document.body.innerHTML = `
      <ul>
        <li><button>Remove</button></li>
        <li><button>Remove</button></li>
      </ul>
    `;
    const { structure } = await ayme.tools.run("snapshot", {});
    const refs = (pattern: RegExp) =>
      [...structure.matchAll(pattern)].map((match) => match[1]!);
    const [, secondRow] = refs(/(e\d+) listitem/g);
    const [, secondButton] = refs(/(e\d+) button "Remove"/g);

    const result = await run({
      groups: [
        { targets: [secondButton!], within: secondRow },
        { targets: [secondButton!] },
      ],
    });

    const button = document.querySelectorAll("button")[1];
    const relative = locatorAt(result, 0, 0);
    expect(relative).toBe("getByRole('button', { name: 'Remove' })");
    expect(elementsOf(page.locator("li").nth(1), relative)).toEqual([button]);
    const pageLevel = locatorAt(result, 1, 0);
    expect(pageLevel).toMatch(/\.nth\(1\)$/);
    expect(elementsOf(page, pageLevel)).toEqual([button]);
  });

  it("prefers the app's test id attribute", async () => {
    const submit = await ref("button", "Submit");
    const result = await run({ groups: [{ targets: [submit] }] });

    expect(locatorAt(result, 0, 0)).toBe("getByTestId('submit-order')");
    expect(elementsOf(page, locatorAt(result, 0, 0))).toEqual([
      element("[data-qa=submit-order]"),
    ]);
  });

  it("returns the button's locator for an icon inside it, addressed by a selector", async () => {
    const result = await run({ groups: [{ targets: ["#icon"] }] });

    expect(elementsOf(page, locatorAt(result, 0, 0))).toEqual([
      element("#settings"),
    ]);
  });

  it("fails each target that cannot be resolved on its own entry and keeps the rest", async () => {
    const heading = await ref("heading", "Orders");
    const account = await accountRootRef();
    const cancel = await ref("button", "Cancel");
    const removed = await ref("button", "Gone");
    element("#gone").remove();

    const result = await run({
      groups: [
        {
          targets: ["e9999", removed, account, "#missing", ".twin", heading],
        },
        { targets: [cancel], within: await ref("listitem", "Order 1") },
      ],
    });

    expect(errorAt(result, 0, 0)).toMatch(/"e9999"/);
    expect(errorAt(result, 0, 1)).toMatch(new RegExp(`"${removed}": removed`));
    expect(account).toMatch(/^s_/);
    expect(errorAt(result, 0, 2)).toMatch(/Page Object AccountPage\.account\b/);
    expect(errorAt(result, 0, 3)).toMatch(/matches no element/);
    expect(errorAt(result, 0, 4)).toMatch(/matches 2 elements/);
    expect(elementsOf(page, locatorAt(result, 0, 5))).toEqual([element("h1")]);
    expect(errorAt(result, 1, 0)).toMatch(/not inside the container "e\d+"/);
  });

  it("fails a group whose container cannot be resolved and keeps the other groups", async () => {
    const dialog = await ref("dialog", "Archive order");
    const confirm = await ref("button", "Confirm archive");
    const account = await accountRootRef();
    const heading = await ref("heading", "Orders");
    element("#dialog").remove();

    const result = await run({
      groups: [
        { targets: [confirm], within: dialog },
        { targets: [heading], within: account },
        { targets: [heading] },
      ],
    });

    expect(result.groups[0]).toEqual({
      within: dialog,
      error: expect.stringMatching(
        /^Cannot scope locators to ref "e\d+": .*removed/
      ),
    });
    expect(result.groups[1]).toEqual({
      within: account,
      error: expect.stringMatching(/Page Object AccountPage\.account\b/),
    });
    expect(elementsOf(page, locatorAt(result, 2, 0))).toEqual([element("h1")]);
  });

  it("gives an agent the same result through the published tool", async () => {
    const heading = await ref("heading", "Orders");
    const input = { groups: [{ targets: [heading] }] };

    expect(await published(input)).toEqual(await run(input));
  });

  it("never acts: no Structural Action, and it is not a Goal Loop operation", async () => {
    const heading = await ref("heading", "Orders");
    const actionsBefore = getInteractionHistory(document).actions().size;

    await run({ groups: [{ targets: [heading, "#icon"] }] });

    expect(getInteractionHistory(document).actions().size).toBe(actionsBefore);
    expect(buildToolOptions().map((option) => option.key)).not.toContain(
      "generate_locator"
    );
  });

  it("rejects input that does not fit its schema", async () => {
    await expect(
      ayme.tools.run("generate_locator", {
        groups: [{ within: "e1" }],
      } as never)
    ).rejects.toBeInstanceOf(ToolInputError);
    await expect(
      ayme.tools.run("generate_locator", {
        groups: [{ targets: ["e1"], root: "e2" }],
      } as never)
    ).rejects.toBeInstanceOf(ToolInputError);
  });
});

describe("generate_locator when the generator fails", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("fails the entry with the generator's reason", async () => {
    document.body.innerHTML = "<h1>Orders</h1>";
    // A page that is not playwright-lite's: the generator rejects it.
    const ayme = createAyme({ pageFactory: () => ({}) as never });
    const stop = ayme.start();
    try {
      const { structure } = await ayme.tools.run("snapshot", {});
      const heading = structure.match(/(e\d+) heading "Orders"/)![1]!;

      const result = await ayme.tools.run("generate_locator", {
        groups: [{ targets: [heading] }],
      });

      expect(result).toEqual({
        groups: [
          {
            locators: [
              {
                target: heading,
                error: expect.stringMatching(
                  new RegExp(`^Cannot generate a locator for "${heading}": `)
                ),
              },
            ],
          },
        ],
      });
    } finally {
      stop();
    }
  });
});

describe("generate_locator before the session starts", () => {
  it("throws RuntimeStateError", async () => {
    const ayme = createAyme();
    await expect(
      ayme.tools.run("generate_locator", { groups: [] })
    ).rejects.toBeInstanceOf(RuntimeStateError);
  });
});
