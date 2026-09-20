import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { ListPage } from "../playwright/pom/ListPage";
import { derivePomManifests } from "@ayme-dev/unplugin-webmcp";

type PublishedTool = {
  name: string;
  description: string;
  inputSchema: unknown;
  execute(args: unknown): Promise<unknown>;
};

type RecordingDriver = {
  tools: PublishedTool[];
};

type ListActions = {
  addItem(text: string): Promise<void>;
  archiveItem(index: number): Promise<void>;
  renameItem(index: number, text: string): Promise<void>;
};

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

const initialToolNames = [
  "get_page_context",
  "click_page_state_ref",
  "fill_page_state_ref",
  "ListPage.addItem",
  "ListPage.items.archive",
  "ListPage.items.rename",
];

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    const publishedTools: PublishedTool[] = [];
    const driver: RecordingDriver & {
      registerTool(
        tool: PublishedTool,
        options: { signal: AbortSignal }
      ): Promise<void>;
    } = {
      tools: publishedTools,
      async registerTool(tool, { signal }) {
        publishedTools.push(tool);
        signal.addEventListener(
          "abort",
          () => {
            const index = publishedTools.indexOf(tool);
            if (index >= 0) publishedTools.splice(index, 1);
          },
          { once: true }
        );
      },
    };
    Object.defineProperty(document, "modelContext", {
      configurable: false,
      value: driver,
    });
  });
});

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

  expect(result).toEqual({ ok: true });
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

test("shows the app model and page state in separate inspector tabs", async ({
  page,
}) => {
  await page.goto("/");

  const appModelTab = page.getByRole("tab", { name: "App Model" });
  const pageStateTab = page.getByRole("tab", { name: "Page State" });
  await expect(appModelTab).toHaveAttribute("aria-selected", "true");

  await pageStateTab.click();

  const pageStatePanel = page.locator("#page-state-panel");
  const output = pageStatePanel.locator(".page-state-output");
  await expect(pageStatePanel).toBeVisible();
  await expect(output).toContainText("ListPage.items");
  await expect(output).not.toContainText("POM inspector");
  await expect(pageStateTab).toHaveAttribute("aria-selected", "true");

  await pageStatePanel.getByRole("button", { name: "Refresh" }).click();
  await expect(output).toContainText("ListPage.items[1]");
});

test("toggles application-model selections and gives hover precedence", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.locator(".highlight-section")).toHaveCount(0);

  const itemInstances = page.locator('[data-instance-list="ListItem"]');
  await itemInstances.locator(".instances-heading").click();

  const firstInstance = itemInstances.locator(
    '[data-instance-path="ListPage.items[0]"]'
  );
  const secondInstance = itemInstances.locator(
    '[data-instance-path="ListPage.items[1]"]'
  );
  await firstInstance.locator(".instance-heading").click();
  await secondInstance.locator(".instance-heading").click();

  const firstArchiveMember = firstInstance.locator(
    '[data-instance-member-name="ListPage.items[0].archiveButton"]'
  );
  const secondArchiveMember = secondInstance.locator(
    '[data-instance-member-name="ListPage.items[1].archiveButton"]'
  );
  const firstArchiveButton = page.getByRole("button", {
    name: "Archive item-1",
  });
  const secondArchiveButton = page.getByRole("button", {
    name: "Archive item-2",
  });

  await firstArchiveMember.hover();
  await expect(firstArchiveButton).toHaveAttribute("data-ayme-highlight", "");
  await firstArchiveMember.click();
  await expect(firstArchiveMember).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("tab", { name: "Page State" }).hover();
  await expect(firstArchiveButton).toHaveAttribute("data-ayme-highlight", "");

  await firstArchiveButton.evaluate((element) =>
    element.removeAttribute("data-ayme-highlight")
  );
  await page.waitForTimeout(80);
  await expect(firstArchiveButton).not.toHaveAttribute("data-ayme-highlight");

  await firstArchiveButton.evaluate((element) =>
    element.setAttribute("data-highlight-refresh", "attribute")
  );
  await expect(firstArchiveButton).toHaveAttribute("data-ayme-highlight", "");

  await firstArchiveButton.evaluate((element) => {
    element.removeAttribute("data-ayme-highlight");
    const text = [...element.childNodes].find(
      (node) => node.nodeType === Node.TEXT_NODE
    );
    if (!text) throw new Error("Expected archive button text.");
    text.textContent = `${text.textContent} `;
  });
  await expect(firstArchiveButton).toHaveAttribute("data-ayme-highlight", "");

  await secondArchiveMember.hover();
  await expect(firstArchiveButton).not.toHaveAttribute("data-ayme-highlight");
  await expect(secondArchiveButton).toHaveAttribute("data-ayme-highlight", "");
  await expect(firstArchiveMember).toHaveAttribute("aria-pressed", "true");

  await page.locator('[data-pom-class="ListItem"] .pom-heading').hover();
  await expect(firstArchiveButton).toHaveAttribute("data-ayme-highlight", "");

  await secondArchiveMember.click();
  await expect(firstArchiveMember).toHaveAttribute("aria-pressed", "false");
  await expect(secondArchiveMember).toHaveAttribute("aria-pressed", "true");

  await secondArchiveMember.click();
  await expect(secondArchiveMember).toHaveAttribute("aria-pressed", "false");
  await page.locator('[data-pom-class="ListItem"] .pom-heading').hover();
  await expect(firstArchiveButton).not.toHaveAttribute("data-ayme-highlight");
  await expect(secondArchiveButton).not.toHaveAttribute("data-ayme-highlight");
});

test("highlights collection and class-level application-model targets", async ({
  page,
}) => {
  await page.goto("/");

  const itemCard = page.locator('[data-pom-class="ListItem"]');
  const classArchiveMember = itemCard.locator(
    '[data-member-name="archiveButton"]'
  );
  const archiveButtons = page.getByRole("button", { name: /Archive item-/ });

  await classArchiveMember.hover();
  await expect(archiveButtons).toHaveCount(2);
  await expect(archiveButtons.nth(0)).toHaveAttribute(
    "data-ayme-highlight",
    ""
  );
  await expect(archiveButtons.nth(1)).toHaveAttribute(
    "data-ayme-highlight",
    ""
  );

  const pageCard = page.locator('[data-pom-class="ListPage"]');
  const itemsMember = pageCard.locator('[data-member-name="items"]');
  const itemRoots = page
    .getByRole("list", { name: "Active items" })
    .getByRole("listitem");

  await itemsMember.hover();
  await expect(itemRoots).toHaveCount(2);
  await expect(itemRoots.nth(0)).toHaveAttribute("data-ayme-highlight", "");
  await expect(itemRoots.nth(1)).toHaveAttribute("data-ayme-highlight", "");

  await page.locator('[data-pom-class="ListPage"] .pom-heading').hover();
  await expect(itemRoots.nth(0)).not.toHaveAttribute("data-ayme-highlight");
  await expect(itemRoots.nth(1)).not.toHaveAttribute("data-ayme-highlight");
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
      archiveItem: async (index) =>
        await executePublishedTool(page, "ListPage.items.archive", {
          index,
          args: {},
        }),
      renameItem: async (index, text) =>
        await executePublishedTool(page, "ListPage.items.rename", {
          index,
          args: { text },
        }),
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

  await executePublishedTool(page, "ListPage.items.archive", {
    index: 0,
    args: {},
  });
  await executePublishedTool(page, "ListPage.items.archive", {
    index: 0,
    args: {},
  });
  await expect
    .poll(async () => await recordedToolNames(page))
    .toEqual([
      "get_page_context",
      "click_page_state_ref",
      "fill_page_state_ref",
      "ListPage.addItem",
    ]);

  await executePublishedTool(page, "ListPage.addItem", {
    text: "Restore live component tools",
  });
  await expect
    .poll(async () => await recordedToolNames(page))
    .toEqual(initialToolNames);
});

test("demonstrates the list app and invokes the generated POM tools from the debug console", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "My list" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "POM inspector" })
  ).toBeVisible();
  const pomCard = page.locator('[data-pom-id="ListPage"]');
  const archiveDialogCard = page.locator('[data-pom-class="ArchiveDialog"]');
  const listItemCard = page.locator('[data-pom-class="ListItem"]');
  await expect(page.locator("[data-pom-class]")).toHaveCount(3);
  await expect(
    pomCard.locator('[data-member-name="newItemInput"]')
  ).toContainText("present");
  await expect(
    pomCard.locator('[data-member-name="addItemButton"]')
  ).toContainText("present");
  await expect(
    archiveDialogCard.locator('[data-member-name="root"]')
  ).toContainText("absent");
  await expect(pomCard.locator('[data-member-name="items"]')).toContainText(
    "2 components"
  );
  await expect(
    listItemCard.locator('[data-member-name="archiveButton"]')
  ).toContainText("present");
  await expect(
    listItemCard.locator('[data-member-name="nameButton"]')
  ).toContainText("present");
  await expect(
    listItemCard.locator('[data-member-name="nameInput"]')
  ).toContainText("absent");
  const itemInstances = listItemCard.locator('[data-instance-list="ListItem"]');
  await expect(itemInstances).not.toHaveAttribute("open", "");
  await expect(itemInstances.locator(".instances-heading")).toContainText(
    "2 instances"
  );
  await itemInstances.locator(".instances-heading").click();
  await expect(
    itemInstances.locator('[data-instance-path="ListPage.items[0]"]')
  ).toContainText("present");
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
          index: { type: "integer", minimum: 0 },
          args: {
            type: "object",
            properties: {},
            required: [],
            additionalProperties: false,
          },
        },
        required: ["index", "args"],
        additionalProperties: false,
      },
    },
    {
      name: "ListPage.items.rename",
      description: "Rename this list item.",
      inputSchema: {
        type: "object",
        properties: {
          index: { type: "integer", minimum: 0 },
          args: {
            type: "object",
            properties: {
              text: { type: "string" },
            },
            required: ["text"],
            additionalProperties: false,
          },
        },
        required: ["index", "args"],
        additionalProperties: false,
      },
    },
  ]);

  await page.getByLabel("New item").fill("Write release notes");
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await expect(
    page.getByText("Write release notes", { exact: true })
  ).toBeVisible();

  const invalidToolInputError = await page.evaluate(async () => {
    const tool = (
      document.modelContext as unknown as RecordingDriver
    ).tools.find((candidate) => candidate.name === "ListPage.items.archive");
    if (!tool) throw new Error("Archive WebMCP tool was not published.");
    try {
      await tool.execute({ index: -1, args: { unexpected: true } });
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    throw new Error("Invalid collection tool input was accepted.");
  });

  expect(invalidToolInputError).toContain("index must be at least 0");

  await executePublishedTool(page, "ListPage.items.archive", {
    index: 0,
    args: {},
  });
  await expect(
    page.getByText("Prepare launch notes", { exact: true })
  ).toBeVisible();
  await expect(page.locator("[data-archived-label]")).toHaveCount(1);

  const addTool = page.locator('[data-tool-name="ListPage.addItem"]');
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
  await addTool.getByLabel("text").fill("Added from debug console");
  await addTool.getByRole("button", { name: "Invoke tool" }).click();
  await expect(
    page.getByText("Added from debug console", { exact: true })
  ).toBeVisible();
  await expect(page.locator(".execution-card").first()).toContainText(
    "getByRole('textbox', { name: 'New item' })"
  );
  await expect(page.locator(".execution-card").first()).toContainText(
    "pressSequentially"
  );
  await expect(page.locator("body")).toHaveAttribute(
    "data-demo-cue-seen",
    "true"
  );
  await expect(page.locator("[data-demo-click-cue]")).toHaveCount(0);

  const renameTool = page.locator('[data-tool-name="ListPage.items.rename"]');
  await renameTool.getByLabel("index").fill("0");
  await renameTool
    .getByLabel("args")
    .fill('{"text":"Renamed from debug console"}');
  await renameTool.getByRole("button", { name: "Invoke tool" }).click();
  await expect(
    page.getByText("Renamed from debug console", { exact: true })
  ).toBeVisible();

  const archiveTool = page.locator('[data-tool-name="ListPage.items.archive"]');
  await archiveTool.getByLabel("index").fill("0");
  await expect(archiveTool.getByLabel("args")).toHaveValue("{}");
  await archiveTool.getByRole("button", { name: "Invoke tool" }).click();
  await expect(page.locator("[data-archived-label]")).toHaveCount(2);

  await page.getByRole("button", { name: "Archive item-3" }).click();
  await expect(
    page.getByRole("dialog", { name: "Archive item" })
  ).toBeVisible();
  await expect(
    archiveDialogCard.locator('[data-member-name="root"]')
  ).toContainText("present");
  await expect(
    archiveDialogCard.locator('[data-member-name="confirmArchiveButton"]')
  ).toContainText("present");
  await expect(addTool).toContainText("WebMCP available");
  // While the modal dialog is open, Reka marks everything outside it
  // aria-hidden, including the inspector host, so role locators cannot reach
  // the inspector's own controls here. See the inspector's `.invoke-button`.
  await expect(addTool.locator(".invoke-button")).toBeEnabled();
  for (const tool of [archiveTool, renameTool]) {
    await expect(tool).toContainText("WebMCP unavailable");
    await expect(tool.locator(".invoke-button")).toBeDisabled();
  }
  await page.getByRole("button", { name: "Confirm archive" }).click();
  await expect(page.locator("[data-archived-label]")).toHaveCount(3);
  for (const tool of [archiveTool, renameTool]) {
    await expect(tool).toContainText("WebMCP available");
    await expect(
      tool.getByRole("button", { name: "Invoke tool" })
    ).toBeEnabled();
  }
  await expect(
    archiveDialogCard.locator('[data-member-name="root"]')
  ).toContainText("absent");

  await page
    .getByLabel("Recent executions")
    .getByRole("button", { name: "Clear" })
    .click();
  await expect(
    page.getByText("Invoke a tool to see its execution here.")
  ).toBeVisible();
});
