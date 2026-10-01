import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { ListPage } from "../playwright/pom/ListPage";
import { derivePomManifests } from "@ayme-dev/unplugin-webmcp";
import {
  recordPublishedTools,
  type RecordingDriver,
} from "@ayme-dev/webmcp/testing";

type ListActions = {
  addItem(text: string): Promise<void>;
  archiveItem(index: number): Promise<void>;
  renameItem(index: number, text: string): Promise<void>;
};

async function getInstanceRef(page: Page, label: string): Promise<string> {
  const pageState = await page.evaluate(async () => {
    const tool = (
      document.modelContext as unknown as RecordingDriver
    ).tools.find((candidate) => candidate.name === "get_page_context");
    if (!tool) throw new Error("get_page_context tool was not published.");
    const result = (await tool.execute({})) as { structure: string };
    return result.structure;
  });
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const ref = pageState.match(
    new RegExp(`(?:^|\\s)((?:e|s_)\\w+) ${escaped}(?:\\b|:)`, "m")
  )?.[1];
  if (!ref) throw new Error(`No ref found for instance label "${label}".`);
  return ref;
}

/** Subtree from `main "Playground"` with refs renumbered from e1. Identical
 *  across platforms; only the ancestors above main differ. */
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
  const refs = new Map<string, string>();
  let n = 0;
  return sub.replace(
    /\be\d+\b/g,
    (r) => refs.get(r) ?? (refs.set(r, `e${++n}`), `e${n}`)
  );
}

// The dev server mounts a Decision Endpoint, so the app runs with the Goal
// Loop on and publishes `pursue_goal` alongside the Page Object tools.
const initialToolNames = [
  "get_page_context",
  "click_page_state_ref",
  "fill_page_state_ref",
  "ListPage.addItem",
  "ListPage.items.archive",
  "ListPage.items.rename",
  "pursue_goal",
];

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

test("derives nested object input schemas from POM action types", () => {
  const [manifest] = derivePomManifests(
    path.resolve("tests/fixtures/objectInputPom.ts")
  );

  expect(manifest?.tools).toEqual([
    {
      methodName: "archive",
      toolName: "ObjectInputPom.archive",
      description: "Archive with structured options.",
      authoredDescription: "Archive with structured options.",
      inputSchema: {
        type: "object",
        properties: {
          options: {
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
        required: ["options"],
        additionalProperties: false,
      },
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
  await page.goto("/");
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
  await page.goto("/");
  await expect
    .poll(async () =>
      (await recordedToolNames(page)).includes("get_page_context")
    )
    .toBe(true);

  const result = await page.evaluate(async () => {
    const tool = (
      document.modelContext as unknown as RecordingDriver
    ).tools.find((candidate) => candidate.name === "get_page_context");
    if (!tool)
      throw new Error("get_page_context WebMCP tool was not published.");
    return {
      hasPomIdentity: "pomId" in tool,
      context: await tool.execute({}),
    };
  });

  expect(result.hasPomIdentity).toBe(false);
  const context = result.context;
  expect(context).toBeTruthy();
  if (!context || typeof context !== "object" || Array.isArray(context))
    throw new Error("Expected get_page_context to return an object payload.");
  const payload = context as {
    pomDefinitions?: unknown;
    structure?: unknown;
  };
  expect(typeof payload.pomDefinitions).toBe("string");
  if (typeof payload.pomDefinitions !== "string")
    throw new Error("Expected page context POM definitions to be a string.");
  expect(payload.pomDefinitions).toContain("POM ListPage");
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
  expect(snapshot).not.toContain("POM inspector");
  expect(normalizeAppSubtree(snapshot)).toMatchSnapshot("page-state.yml");
});

test("runs the same POM behavior through registered WebMCP tools", async ({
  page,
}) => {
  await page.goto("/");
  await expect
    .poll(async () => await recordedToolNames(page))
    .toEqual(initialToolNames);

  await runListActions(
    page,
    {
      addItem: async (text) =>
        await executePublishedTool(page, "ListPage.addItem", { text }),
      archiveItem: async (index) => {
        const ref = await getInstanceRef(page, `ListPage.items[${index}]`);
        await executePublishedTool(page, "ListPage.items.archive", {
          ref,
          args: {},
        });
      },
      renameItem: async (index, text) => {
        const ref = await getInstanceRef(page, `ListPage.items[${index}]`);
        await executePublishedTool(page, "ListPage.items.rename", {
          ref,
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
  await page.goto("/");
  await expect
    .poll(async () => await recordedToolNames(page))
    .toEqual(initialToolNames);

  const firstRef = await getInstanceRef(page, "ListPage.items[0]");
  await executePublishedTool(page, "ListPage.items.archive", {
    ref: firstRef,
    args: {},
  });
  const remainingRef = await getInstanceRef(page, "ListPage.items[0]");
  await executePublishedTool(page, "ListPage.items.archive", {
    ref: remainingRef,
    args: {},
  });
  await expect
    .poll(async () => await recordedToolNames(page))
    .toEqual([
      "get_page_context",
      "click_page_state_ref",
      "fill_page_state_ref",
      "ListPage.addItem",
      "pursue_goal",
    ]);

  await executePublishedTool(page, "ListPage.addItem", {
    text: "Restore live component tools",
  });
  await expect
    .poll(async () => await recordedToolNames(page))
    .toEqual(initialToolNames);
});

test("demonstrates the list app and invokes the generated POM tools", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "My list" })).toBeVisible();
  await expect
    .poll(async () => await recordedToolNames(page))
    .toEqual(initialToolNames);

  const tools = await recordedTools(page);

  expect(tools).toEqual([
    {
      name: "get_page_context",
      description:
        "Return the current live structural page state together with compact POM capability definitions known to Ayme. `structure` is the current page snapshot. A bare member is a Locator; member: ChildPom is a child POM; [] marks collections; and action(args): this | OtherPom is an action with possible next POMs. Action comments are authored descriptions, and this means the current POM. Definitions can include POMs or actions that are not currently visible or callable; action return POMs describe possible next surfaces, not guarantees. The client's currently registered tool schemas remain authoritative for what can be called now.",
      inputSchema: {
        type: "object",
        properties: {
          names: { type: "array", items: { type: "string" } },
        },
        required: [],
        additionalProperties: false,
      },
    },
    {
      name: "click_page_state_ref",
      description:
        "Click a real element ref from get_page_context. The ref is resolved against a fresh capture before the action.",
      inputSchema: {
        type: "object",
        properties: { ref: { type: "string" } },
        required: ["ref"],
        additionalProperties: false,
      },
    },
    {
      name: "fill_page_state_ref",
      description:
        "Fill a real editable element ref from get_page_context with text. The ref is resolved against a fresh capture before the action.",
      inputSchema: {
        type: "object",
        properties: { ref: { type: "string" }, value: { type: "string" } },
        required: ["ref", "value"],
        additionalProperties: false,
      },
    },
    {
      name: "ListPage.addItem",
      description: "Add a new item to the list.",
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
      name: "ListPage.items.archive",
      description: "Archive this list item.",
      inputSchema: {
        type: "object",
        properties: {
          ref: {
            type: "string",
            description:
              "Structural Ref of the instance's Page Object Root, as labelled in the page state.",
          },
          args: {
            type: "object",
            properties: {},
            required: [],
            additionalProperties: false,
          },
        },
        required: ["ref", "args"],
        additionalProperties: false,
      },
    },
    {
      name: "ListPage.items.rename",
      description: "Rename this list item.",
      inputSchema: {
        type: "object",
        properties: {
          ref: {
            type: "string",
            description:
              "Structural Ref of the instance's Page Object Root, as labelled in the page state.",
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
        required: ["ref", "args"],
        additionalProperties: false,
      },
    },
    {
      name: "pursue_goal",
      description:
        "Drive the page toward a goal in steps. Each step is one fast model judgement. Returns a Handover: why the loop stopped, what it did, and what to do next.",
      inputSchema: {
        type: "object",
        properties: {
          goal: { type: "string" },
          maxSteps: { type: "integer" },
        },
        required: ["goal", "maxSteps"],
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
    ).tools.find((candidate) => candidate.name === "ListPage.items.archive");
    if (!tool) throw new Error("Archive WebMCP tool was not published.");
    return tool.execute({ ref: "e99999", args: { unexpected: true } });
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

  const firstItemRef = await getInstanceRef(page, "ListPage.items[0]");
  await executePublishedTool(page, "ListPage.items.archive", {
    ref: firstItemRef,
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

  await executePublishedTool(page, "ListPage.items.rename", {
    ref: await getInstanceRef(page, "ListPage.items[0]"),
    args: { text: "Renamed through a tool" },
  });
  await expect(
    page.getByText("Renamed through a tool", { exact: true })
  ).toBeVisible();

  await executePublishedTool(page, "ListPage.items.archive", {
    ref: await getInstanceRef(page, "ListPage.items[0]"),
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
    .toEqual([
      "get_page_context",
      "click_page_state_ref",
      "fill_page_state_ref",
      "ListPage.addItem",
      "pursue_goal",
    ]);
  await page.getByRole("button", { name: "Confirm archive" }).click();
  await expect(page.locator("[data-archived-label]")).toHaveCount(3);
  await expect
    .poll(async () => await recordedToolNames(page))
    .toEqual(initialToolNames);
});

// The playground's Inspector smoke test. It stays minimal until the
// Inspector's own Page Object Model can drive it.
test("opens the Inspector and runs a tool from it", async ({ page }) => {
  await page.goto("/");

  const inspector = page.getByRole("complementary", { name: "ayme" });
  await expect(inspector).toBeVisible();
  const addTool = inspector.locator('[data-tool-name="ListPage.addItem"]');
  await addTool.getByLabel("text").fill("Added from the Inspector");
  await addTool.getByRole("button", { name: "Invoke" }).click();

  await expect(
    page
      .getByRole("list", { name: "Active items" })
      .getByText("Added from the Inspector", { exact: true })
  ).toBeVisible();
});
