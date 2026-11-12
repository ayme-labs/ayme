import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  ayme,
  createAyme,
  registerCompiledPom,
  type PlaywrightAyme,
} from "@ayme-dev/ayme/playwright";
import {
  connectPage,
  freePort,
  ignoreAutoPairScan,
  startAgent,
} from "@ayme-dev/mcp/testing";

// E2E, tracer bullet 5 of the Node host work (#1169): on the dogfood page the
// page's own runtime runs and answers an agent through `ayme mcp`, while a
// Node host attaches to the same page through `@ayme-dev/ayme/playwright`.
// Both mint refs for the page's elements, which they must do from one ref
// world: over a hundred additions, with each side reading the page right after
// the other acted, no capture shows a ref twice, the page's runtime never
// refuses one, a click through a ref lands on its element, and the Change
// Record of the same action is the same on both sides.

const ADDITIONS_PER_SIDE = 52;
// Items on the list before it is cleared, so every item is in view to click.
const BATCH = 5;
const CLICK_EVERY = 4;

/** An item on the list, as a Node host's Page Object (its browser twin is compiled by the plugin). */
class ListItem {
  constructor(readonly root: Locator) {}
}
ayme({ root: (self: ListItem) => self.root })(ListItem);

/**
 * The fixture's list page, as a Node host's Page Object: the browser's twin
 * is compiled by the plugin, so this one is registered with the same manifest.
 */
class ListPage {
  readonly newItemInput;
  readonly addItemButton;
  readonly items;
  constructor(page: Page) {
    this.newItemInput = page.getByRole("textbox", { name: "New item" });
    this.addItemButton = page.getByRole("button", { name: "Add item" });
    this.items = page
      .getByRole("list", { name: "Items" })
      .getByRole("listitem");
  }
  async entries() {
    return (await this.items.all()).map((item) => new ListItem(item));
  }
  async addItem(text: string) {
    await this.newItemInput.fill(text);
    await this.addItemButton.click();
  }
}
ayme(ListPage);
registerCompiledPom(ListPage, {
  className: "ListPage",
  members: [
    { memberName: "newItemInput", kind: "locator", access: "field" },
    { memberName: "addItemButton", kind: "locator", access: "field" },
    {
      memberName: "items",
      kind: "locator",
      access: "field",
      collection: true,
    },
    {
      memberName: "entries",
      kind: "component",
      access: "method",
      componentClassName: "ListItem",
      collection: true,
    },
  ],
  components: [{ className: "ListItem", members: [], tools: [] }],
  tools: [
    {
      methodName: "addItem",
      toolName: "ListPage.addItem",
      parameters: [
        { name: "text", optional: false, schema: { type: "string" } },
      ],
    },
  ],
});

type Run = { changes: string };

/** The refs a page state prints at the start of a line, in order. */
const refsIn = (structure: string) =>
  [...structure.matchAll(/^\s*- (e\d+)\b/gm)].map(([, ref]) => ref!);

/** The ref of the page's list item that shows exactly `text`. */
function refOf(structure: string, text: string) {
  const lines = structure.split("\n");
  const panel = lines.findIndex((line) => /complementary "ayme"/.test(line));
  const line = lines
    .slice(0, panel === -1 ? undefined : panel)
    .find((candidate) => candidate.endsWith(`: ${text}`));
  const ref = /- (e\d+)\b/.exec(line ?? "")?.[1];
  if (!ref) throw new Error(`No item "${text}" in:\n${structure}`);
  return ref;
}

/**
 * What a Change Record says of the page's own `main`, with its refs and the
 * item's text left out. Whether the list or the focused button shows depends
 * on what the other side did before, not on who acted.
 */
function mainOf(changes: string) {
  const lines = changes.split("\n");
  const start = lines.findIndex((line) => / main(:| |$)/.test(line));
  const end = lines.findIndex(
    (line, index) => index > start && /complementary|PanelShell/.test(line)
  );
  return lines
    .slice(start, end === -1 ? undefined : end)
    .filter((line) => !/ list "Items"| <changed> button "Add item"/.test(line))
    .map((line) => line.trim())
    .join("\n")
    .replace(/\be\d+\b/g, "eN")
    .replace(/(Item|Node) \d+/g, "X");
}

test("a Node host and the page's own runtime share one ref world over a hundred additions", async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(600_000);
  await ignoreAutoPairScan(context);
  const agent = await startAgent(
    "--port",
    String(await freePort()),
    "--browser-tools"
  );
  try {
    await connectPage(agent, page, `${baseURL}/dogfood.html`);
    // Where a click lands: the text of the element it reached.
    await page.evaluate(() => {
      const clicked: string[] = [];
      (window as unknown as { clicked: string[] }).clicked = clicked;
      document.addEventListener(
        "click",
        (event) =>
          clicked.push((event.target as Element).textContent?.trim() ?? ""),
        true
      );
    });
    const node: PlaywrightAyme = createAyme({
      page,
      pageObjects: [ListPage],
    });
    const stop = await node.start();

    const nodeSees = async () =>
      ((await node.tools.run("snapshot", {})) as { structure: string })
        .structure;
    const agentSees = async () => {
      const { text, isError } = await agent.call("snapshot");
      // The page's runtime refuses a capture with a ref twice.
      expect(isError, text).toBe(false);
      return (JSON.parse(text) as { structure: string }).structure;
    };
    const lastClick = () =>
      page.evaluate(() =>
        (window as unknown as { clicked: string[] }).clicked.at(-1)
      );
    const unique = (structure: string, side: string) => {
      const refs = refsIn(structure);
      expect(new Set(refs).size, `${side} sees a ref twice`).toBe(refs.length);
    };

    const records = { agent: [] as string[], node: [] as string[] };
    for (let step = 1; step <= ADDITIONS_PER_SIDE; step += 1) {
      // Each side reads the page right before it acts, so its Change Record
      // starts there, and right after the other acted, in turn first.
      const nodeFirst = step % 2 === 1;
      const addByNode = async () => {
        await nodeSees();
        const { changes } = (await node.tools.run("ListPage.addItem", {
          text: `Node ${step}`,
        })) as unknown as Run;
        records.node.push(mainOf(changes));
      };
      const addByAgent = async () => {
        await agentSees();
        const { text, isError } = await agent.call("ListPage.addItem", {
          text: `Item ${step}`,
        });
        expect(isError, text).toBe(false);
        records.agent.push(mainOf((JSON.parse(text) as Run).changes));
      };
      if (nodeFirst) {
        await addByNode();
        await addByAgent();
      } else {
        await addByAgent();
        await addByNode();
      }

      const seenByNode = await nodeSees();
      const seenByAgent = await agentSees();
      unique(seenByNode, "the Node host");
      unique(seenByAgent, "the page's runtime");
      for (const added of [`Node ${step}`, `Item ${step}`])
        expect(refOf(seenByNode, added), added).toBe(refOf(seenByAgent, added));

      // A click through a ref lands on its element, whoever clicks: the
      // agent through its tool, the Node host through its own Playwright.
      // Each click takes seconds on a page this busy, so some steps click.
      if (step % CLICK_EVERY === 1) {
        const nodeItem = refOf(seenByAgent, `Node ${step}`);
        const click = await agent.call("click", { target: nodeItem });
        expect(click.isError, click.text).toBe(false);
        expect(await lastClick()).toBe(`Node ${step}`);
        const agentItem = refOf(seenByNode, `Item ${step}`);
        await page.locator(`ayme-ref=${agentItem}`).click();
        expect(await lastClick()).toBe(`Item ${step}`);
      }

      // The agent's actions time out after a second, which a list that
      // scrolls and the panel's Runs timeline, one more row for every call,
      // would overrun: so each batch clears both.
      if (step % BATCH === 0) {
        const cleared = await agent.call("ListPage.clear");
        expect(cleared.isError, cleared.text).toBe(false);
        const runs = /RunsView (po\d+)/.exec(await agentSees())?.[1];
        const forgotten = await agent.call("RunsView.clear", { id: runs });
        expect(forgotten.isError, forgotten.text).toBe(false);
      }
    }

    expect(records.node).toHaveLength(ADDITIONS_PER_SIDE);
    // The same action leaves the same Change Record on either side.
    expect(records.node).toEqual(records.agent);
    expect(records.agent).toHaveLength(ADDITIONS_PER_SIDE);
    stop();
  } finally {
    await agent.close();
  }
});
