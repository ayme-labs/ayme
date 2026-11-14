import path from "node:path";

import { expect, selectors, type Page } from "@playwright/test";
import { connectPage, freePort, startAgent } from "@ayme-dev/mcp/testing";
import { exampleTest as test } from "@ayme-dev/example-certification/tests";

import { ListPage } from "../playwright/pom/ListPage";
import { createPomCompiler } from "@ayme-dev/ayme/compiler";
import {
  Inspector,
  registerInspectorSelectors,
} from "@ayme-dev/inspector/testing";
import {
  recordPublishedTools,
  type RecordingDriver,
} from "@ayme-dev/webmcp/testing";

/**
 * The coding agents' servers (`ayme mcp --browser-tools`) the tests started,
 * by the page each one is paired with. WebMCP publishes no Browser Tool and no
 * `snapshot`, so a test that reads the page state or clicks reaches them
 * through its server, as a coding agent does.
 */
const agents = new Map<Page, Awaited<ReturnType<typeof startAgent>>>();
test.afterEach(async () => {
  await Promise.all([...agents.values()].map((agent) => agent.close()));
  agents.clear();
});

/** Opens the playground, paired with an `ayme mcp --browser-tools` server. */
async function openPaired(page: Page) {
  const agent = await startAgent(
    "--port",
    String(await freePort()),
    "--browser-tools"
  );
  agents.set(page, agent);
  const baseURL = test.info().project.use.baseURL!;
  await connectPage(agent, page, new URL("/", baseURL).href, {
    timeout: 45_000,
  });
  return agent;
}

/** Calls one of the paired server's tools and parses its JSON text. */
async function callAgent(page: Page, name: string, input = {}) {
  const { text, isError } = await agents.get(page)!.call(name, input);
  return { isError, text, json: () => JSON.parse(text) as unknown };
}

/**
 * Opens the playground with the Inspector collapsed, for a test that clicks
 * the archive dialog itself, as a person does. The panel paints above the
 * page's own UI and at its default place covers the dialog's confirm button.
 * Tool calls pass through the panel; a person moves or collapses it.
 */
async function openWithInspectorCollapsed(page: Page) {
  await openPaired(page);
  await new Inspector(page).collapse();
}

/**
 * Opens the playground once the Inspector is on it, for a test that calls
 * tools as an agent. Tool calls pass through the panel once it is mounted; a
 * call already running when it mounts over the call's target does not.
 */
async function openWithInspector(page: Page) {
  await openPaired(page);
  await new Inspector(page).open();
}

type ListActions = {
  addItem(text: string): Promise<void>;
  archiveItem(index: number): Promise<void>;
  renameItem(index: number, text: string): Promise<void>;
};

async function getInstanceId(
  page: Page,
  className: string,
  index = 0
): Promise<string> {
  const pageState = (
    (await callAgent(page, "snapshot")).json() as { structure: string }
  ).structure;
  const id = [...pageState.matchAll(new RegExp(` ${className} (po\\d+)`, "g"))][
    index
  ]?.[1];
  if (!id) throw new Error(`No Page Object id found for "${className}".`);
  return id;
}

/** Subtree from `main "Playground"` with refs renumbered from e1 and Page
 *  Object ids from po1. Identical across platforms; only the ancestors above
 *  main differ. */
function normalizeAppSubtree(pageState: string): string {
  const lines = pageState.split("\n");
  const root = lines.findIndex((l) => l.includes('main "Playground"'));
  if (root === -1) throw new Error('main "Playground" not found.');
  const indent = lines[root]!.search(/\S/);
  let end = root + 1;
  while (
    end < lines.length &&
    (lines[end]!.trim() === "" || lines[end]!.search(/\S/) > indent)
  )
    end++;
  const sub = lines
    .slice(root, end)
    .filter((l) => l.trim())
    .map((l) => l.slice(indent))
    .join("\n");
  const renumbered = (prefix: string) => {
    const seen = new Map<string, string>();
    return (found: string) => {
      if (!seen.has(found)) seen.set(found, `${prefix}${seen.size + 1}`);
      return seen.get(found)!;
    };
  };
  return sub
    .replace(/\be\d+\b/g, renumbered("e"))
    .replace(/\bpo\d+\b/g, renumbered("po"));
}

// WebMCP publishes the Page Object Tools and page_objects only.
const initialToolNames = [
  "page_objects",
  "ListPage.addItem",
  "ListItem.archive",
  "ListItem.rename",
];

// The Inspector renders into a closed shadow root; its page objects reach it
// through this selector engine.
test.beforeAll(() => registerInspectorSelectors(selectors));
test.beforeEach(({ context }) => recordPublishedTools(context));

async function runListActions(
  page: Page,
  actions: ListActions,
  itemText: string
) {
  await actions.addItem(itemText);
  await expect(page.getByText(itemText, { exact: true })).toBeVisible();

  await actions.renameItem(0, "Prepare the launch notes");
  await expect(
    page.getByText("Prepare the launch notes", { exact: true })
  ).toBeVisible();

  await actions.archiveItem(0);
  await expect(
    page.getByText("Prepare the launch notes", { exact: true })
  ).toBeVisible();
  await expect(page.locator("[data-archived-label]")).toHaveCount(1);
}

async function executePublishedTool(page: Page, name: string, args: unknown) {
  const result = await page.evaluate(
    async ({ args, name }) => {
      const tool = (
        document.modelContext as unknown as RecordingDriver
      ).tools.find((candidate) => candidate.name === name);
      if (!tool) throw new Error(`${name} WebMCP tool was not published.`);
      return await tool.execute(args);
    },
    { args, name }
  );

  expect(result).toMatchObject({ settled: true });
}

async function recordedTools(page: Page) {
  return await page.evaluate(() =>
    (document.modelContext as unknown as RecordingDriver).tools.map((tool) => ({
      description: tool.description,
      inputSchema: tool.inputSchema,
      name: tool.name,
    }))
  );
}

async function recordedToolNames(page: Page) {
  return (await recordedTools(page)).map((tool) => tool.name);
}

/**
 * The published tool names, sorted: a tool that comes back is registered
 * after the tools that stayed published, so after a change the registration
 * order is not the publication order.
 */
async function recordedToolSet(page: Page) {
  return (await recordedToolNames(page)).sort();
}

test("derives nested object input schemas from POM action types", () => {
  const [manifest] = createPomCompiler().derivePomManifests(
    path.resolve("tests/fixtures/objectInputPom.ts")
  );

  expect(manifest?.tools).toEqual([
    {
      methodName: "archive",
      toolName: "ObjectInputPom.archive",
      description: "Archive with structured options.",
      parameters: [
        {
          name: "options",
          optional: false,
          schema: {
            type: "object",
            properties: {
              reason: { type: "string", enum: ["obsolete", "duplicate"] },
              notification: {
                type: "object",
                properties: {
                  channel: { type: "string", enum: ["email", "in-app"] },
                  includeLink: { type: "boolean" },
                },
                required: ["channel"],
                additionalProperties: false,
              },
            },
            required: ["reason"],
            additionalProperties: false,
          },
        },
      ],
    },
  ]);
});

test("runs the WebMCP POM source through real Playwright", async ({ page }) => {
  await openWithInspectorCollapsed(page);
  const listPage = new ListPage(page);

  await runListActions(
    page,
    {
      addItem: async (text) => await listPage.addItem(text),
      archiveItem: async (index) => {
        const items = await listPage.items();
        const item = items[index];
        if (!item) throw new Error(`No list item exists at index ${index}.`);
        await item.archive();
      },
      renameItem: async (index, text) => {
        const items = await listPage.items();
        const item = items[index];
        if (!item) throw new Error(`No list item exists at index ${index}.`);
        await item.rename(text);
      },
    },
    "Added through Playwright"
  );
});

test("publishes the current page as ref-bearing ARIA state", async ({
  page,
}) => {
  await openPaired(page);
  // The Inspector is open on the page, so leaving it out is observable.
  await new Inspector(page).open();
  await expect
    .poll(async () =>
      (await recordedToolNames(page)).includes("ListPage.addItem")
    )
    .toBe(true);

  const result = {
    hasPomIdentity: await page.evaluate(() => {
      const tool = (
        document.modelContext as unknown as RecordingDriver
      ).tools.find((candidate) => candidate.name === "ListPage.addItem");
      if (!tool) throw new Error("ListPage.addItem was not published.");
      return "pomId" in tool;
    }),
    context: (await callAgent(page, "snapshot")).json(),
  };

  expect(result.hasPomIdentity).toBe(false);
  const context = result.context;
  expect(context).toBeTruthy();
  if (!context || typeof context !== "object" || Array.isArray(context))
    throw new Error("Expected snapshot to return an object payload.");
  const payload = context as {
    pomDefinitions?: unknown;
    structure?: unknown;
  };
  expect(typeof payload.pomDefinitions).toBe("string");
  if (typeof payload.pomDefinitions !== "string")
    throw new Error("Expected page context POM definitions to be a string.");
  expect(payload.pomDefinitions).toMatch(/^ListPage\b/m);
  expect(payload.pomDefinitions).toContain("newItemInput");
  const snapshot = payload.structure;
  expect(typeof snapshot).toBe("string");
  if (typeof snapshot !== "string")
    throw new Error("Expected page context structure to be a string.");

  const archiveRefs = [
    ...snapshot.matchAll(/- (e\d+) button "Archive item-[12]"/g),
  ].map((match) => match[1]);
  expect(archiveRefs).toHaveLength(2);
  expect(new Set(archiveRefs).size).toBe(2);
  // The panel is titled and labelled "ayme"; the playground never says it.
  expect(snapshot).not.toMatch(/\bayme\b/);
  // `ignore` keeps the site header out.
  expect(snapshot).not.toContain("Ayme WebMCP");
  expect(normalizeAppSubtree(snapshot)).toMatchSnapshot("page-state.yml");
});

test("scrolls the app back into view when a tool acts on it from the code view", async ({
  page,
}) => {
  await openWithInspector(page);
  await expect
    .poll(async () => await recordedToolNames(page))
    .toEqual(initialToolNames);
  const id = await getInstanceId(page, "ListItem");
  const appView = page.getByRole("button", { name: "App", exact: true });

  await page.getByRole("button", { name: "Page Object code" }).click();
  await expect(page.getByRole("tabpanel")).toContainText(
    "export class ListPage"
  );
  await expect(appView).toHaveAttribute("aria-pressed", "false");
  // The app stays on the page, a scroll away.
  expect(await recordedToolNames(page)).toEqual(initialToolNames);

  await executePublishedTool(page, "ListItem.rename", {
    id,
    args: { text: "Renamed from the code view" },
  });
  await expect(appView).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByText("Renamed from the code view", { exact: true })
  ).toBeVisible();
});

test("loads the code view when a swipe reaches it", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("region", { name: "Demo application" }).hover();
  await page.mouse.wheel(2000, 0);

  await expect(
    page.getByRole("button", { name: "App", exact: true })
  ).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("tabpanel")).toContainText(
    "export class ListPage"
  );
});

test("resolves every ref of a snapshot taken after the archive dialog closes", async ({
  page,
}) => {
  await openWithInspectorCollapsed(page);
  const snapshot = async () =>
    ((await callAgent(page, "snapshot")).json() as { structure: string })
      .structure;

  const archive = /- (e\d+) button "Archive item-1"/.exec(await snapshot());
  if (!archive) throw new Error("No ref for the Archive item-1 button.");
  await callAgent(page, "click", { target: archive[1] });
  await callAgent(page, "press_key", { key: "Escape" });

  // The dialog's portal wrapped the page's root and then left again.
  const refs = [...new Set((await snapshot()).match(/\be\d+\b/g))];
  expect(refs.length).toBeGreaterThan(0);
  const refused: string[] = [];
  for (const target of refs)
    if ((await callAgent(page, "hover", { target })).isError)
      refused.push(target);
  expect(refused).toEqual([]);
});

test("runs the same POM behavior through registered WebMCP tools", async ({
  page,
}) => {
  await openWithInspector(page);
  await expect
    .poll(async () => await recordedToolNames(page))
    .toEqual(initialToolNames);

  await runListActions(
    page,
    {
      addItem: async (text) =>
        await executePublishedTool(page, "ListPage.addItem", { text }),
      archiveItem: async (index) => {
        const id = await getInstanceId(page, "ListItem", index);
        await executePublishedTool(page, "ListItem.archive", { id });
      },
      renameItem: async (index, text) => {
        const id = await getInstanceId(page, "ListItem", index);
        await executePublishedTool(page, "ListItem.rename", {
          id,
          args: { text },
        });
      },
    },
    "Added through WebMCP"
  );
});

test("publishes collection tools only while a component root is live", async ({
  page,
}) => {
  await openWithInspector(page);
  await expect
    .poll(async () => await recordedToolNames(page))
    .toEqual(initialToolNames);

  const firstId = await getInstanceId(page, "ListItem");
  await executePublishedTool(page, "ListItem.archive", {
    id: firstId,
    args: {},
  });
  const remainingId = await getInstanceId(page, "ListItem");
  await executePublishedTool(page, "ListItem.archive", {
    id: remainingId,
    args: {},
  });
  await expect
    .poll(async () => await recordedToolNames(page))
    .toEqual(["page_objects", "ListPage.addItem"]);

  await executePublishedTool(page, "ListPage.addItem", {
    text: "Restore live component tools",
  });
  await expect
    .poll(async () => await recordedToolSet(page))
    .toEqual([...initialToolNames].sort());
});

test("demonstrates the list app and invokes the generated POM tools", async ({
  page,
}) => {
  await openWithInspectorCollapsed(page);

  await expect(page.getByRole("heading", { name: "My list" })).toBeVisible();
  await expect
    .poll(async () => await recordedToolNames(page))
    .toEqual(initialToolNames);

  const tools = await recordedTools(page);

  expect(tools).toEqual([
    {
      name: "page_objects",
      description:
        "Returns the Page Objects on the page now as a tree: each one's class, its declared children with their values, and the id (po<n>) of each one that has a root.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
    {
      name: "ListPage.addItem",
      description: "Run addItem.",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string" },
        },
        required: ["text"],
        additionalProperties: false,
      },
    },
    {
      name: "ListItem.archive",
      description: "An archived item can't be renamed or restored.",
      inputSchema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description:
              "The Page Object's id, written po<n>. The page state shows it on the Page Object Root.",
          },
          args: {
            type: "object",
            properties: {},
            required: [],
            additionalProperties: false,
          },
        },
        required: ["id"],
        additionalProperties: false,
      },
    },
    {
      name: "ListItem.rename",
      description: "Run rename.",
      inputSchema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description:
              "The Page Object's id, written po<n>. The page state shows it on the Page Object Root.",
          },
          args: {
            type: "object",
            properties: {
              text: { type: "string" },
            },
            required: ["text"],
            additionalProperties: false,
          },
        },
        required: ["id", "args"],
        additionalProperties: false,
      },
    },
  ]);

  await page.getByLabel("New item").fill("Write release notes");
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await expect(
    page.getByText("Write release notes", { exact: true })
  ).toBeVisible();

  const invalidToolInputResult = await page.evaluate(async () => {
    const tool = (
      document.modelContext as unknown as RecordingDriver
    ).tools.find((candidate) => candidate.name === "ListItem.archive");
    if (!tool) throw new Error("Archive WebMCP tool was not published.");
    return tool.execute({ id: "po99999", args: { unexpected: true } });
  });

  expect(invalidToolInputResult).toEqual({
    content: [
      {
        type: "text",
        text: expect.stringMatching(
          /^ToolInputError: .*args\.unexpected is not supported/
        ),
      },
    ],
    isError: true,
  });

  const firstItemId = await getInstanceId(page, "ListItem");
  await executePublishedTool(page, "ListItem.archive", {
    id: firstItemId,
    args: {},
  });
  await expect(
    page.getByText("Prepare launch notes", { exact: true })
  ).toBeVisible();
  await expect(page.locator("[data-archived-label]")).toHaveCount(1);

  await page.evaluate(() => {
    const observer = new MutationObserver((records) => {
      if (
        records.some((record) =>
          [...record.addedNodes].some(
            (node) =>
              node instanceof Element &&
              node.hasAttribute("data-demo-click-cue")
          )
        )
      ) {
        document.body.dataset.demoCueSeen = "true";
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true });
  });
  await executePublishedTool(page, "ListPage.addItem", {
    text: "Added through a tool",
  });
  await expect(
    page.getByText("Added through a tool", { exact: true })
  ).toBeVisible();
  await expect(page.locator("body")).toHaveAttribute(
    "data-demo-cue-seen",
    "true"
  );
  await expect(page.locator("[data-demo-click-cue]")).toHaveCount(0);

  await executePublishedTool(page, "ListItem.rename", {
    id: await getInstanceId(page, "ListItem"),
    args: { text: "Renamed through a tool" },
  });
  await expect(
    page.getByText("Renamed through a tool", { exact: true })
  ).toBeVisible();

  await executePublishedTool(page, "ListItem.archive", {
    id: await getInstanceId(page, "ListItem"),
    args: {},
  });
  await expect(page.locator("[data-archived-label]")).toHaveCount(2);

  // The modal dialog hides the list, so its collection tools are withdrawn
  // until the dialog closes.
  await page.getByRole("button", { name: "Archive item-3" }).click();
  await expect(
    page.getByRole("dialog", { name: "Archive item" })
  ).toBeVisible();
  await expect
    .poll(async () => await recordedToolNames(page))
    .toEqual(["page_objects", "ListPage.addItem"]);
  await page.getByRole("button", { name: "Confirm archive" }).click();
  await expect(page.locator("[data-archived-label]")).toHaveCount(3);
  await expect
    .poll(async () => await recordedToolSet(page))
    .toEqual([...initialToolNames].sort());
});

// The playground's Inspector smoke test: the hosted Inspector opens
// and runs a tool, driven through the Inspector's own Page Object Model.
test("opens the Inspector and runs a tool from it", async ({ page }) => {
  await page.goto("/");
  const inspector = new Inspector(page);

  await inspector.open();
  const addItem = await inspector.tool("ListPage.addItem");
  await addItem.run({ text: "Added from the Inspector" });

  await expect(
    page
      .getByRole("list", { name: "Active items" })
      .getByText("Added from the Inspector", { exact: true })
  ).toBeVisible();
});

test("tells analytics who ran which tool", async ({ page }) => {
  await page.goto("/");
  const inspector = new Inspector(page);
  await expect
    .poll(async () => await recordedToolNames(page))
    .toEqual(initialToolNames);

  await executePublishedTool(page, "ListPage.addItem", {
    text: "Added by a browser agent",
  });
  await inspector.open();
  const addItem = await inspector.tool("ListPage.addItem");
  await addItem.run({ text: "Added from the Inspector" });

  await expect
    .poll(() =>
      page.evaluate(() =>
        window.dataLayer?.filter(
          (entry) => "event" in entry && entry.event === "playground_tool_run"
        )
      )
    )
    .toEqual([
      {
        event: "playground_tool_run",
        tool: "ListPage.addItem",
        caller: "webmcp",
        status: "succeeded",
      },
      {
        event: "playground_tool_run",
        tool: "ListPage.addItem",
        caller: "inspector",
        status: "succeeded",
      },
    ]);
});
