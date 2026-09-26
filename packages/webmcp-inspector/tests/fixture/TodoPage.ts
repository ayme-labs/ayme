import type { Locator, Page } from "@playwright/test";

import type { PomManifest } from "@ayme-dev/webmcp";

/**
 * The model fixture's Page Object: a to-do list whose items are child Page
 * Objects, and an archive dialog that is not on the page. The runtime
 * constructs it on playwright-lite. Its locators are CSS, so they never match
 * the Inspector's own text.
 */
export class TodoPage {
  readonly newItemInput: Locator;
  readonly addItemButton: Locator;
  readonly archiveDialog: ArchiveDialog;
  private readonly rows: Locator;

  constructor(page: Page) {
    this.newItemInput = page.locator("#todo-new");
    this.addItemButton = page.locator("#todo-add");
    this.rows = page.locator("#todo-items > li");
    this.archiveDialog = new ArchiveDialog(page.locator("#todo-archive"));
  }

  get items(): Promise<TodoItem[]> {
    return this.rows.all().then((rows) => rows.map((row) => new TodoItem(row)));
  }

  /** Add an item to the list. */
  async addItem(text: string) {
    await this.newItemInput.fill(text);
    await this.addItemButton.click();
  }
}

export class TodoItem {
  readonly root: Locator;
  readonly archiveButton: Locator;

  constructor(root: Locator) {
    this.root = root;
    this.archiveButton = root.locator(".todo-archive");
  }

  /** Archive this item. */
  async archive() {
    await this.archiveButton.click();
  }
}

export class ArchiveDialog {
  readonly root: Locator;
  readonly confirmButton: Locator;

  constructor(root: Locator) {
    this.root = root;
    this.confirmButton = root.locator(".todo-confirm");
  }
}

const noArguments = {
  type: "object",
  properties: {},
  required: [],
  additionalProperties: false,
} as const;

/** What the Ayme compiler derives from this file. */
export const todoPageManifest: PomManifest = {
  className: "TodoPage",
  members: [
    { memberName: "newItemInput", kind: "locator", access: "field" },
    { memberName: "addItemButton", kind: "locator", access: "field" },
    {
      memberName: "items",
      kind: "component",
      access: "getter",
      componentClassName: "TodoItem",
      collection: true,
    },
    {
      memberName: "archiveDialog",
      kind: "component",
      access: "field",
      componentClassName: "ArchiveDialog",
      collection: false,
    },
  ],
  components: [
    {
      className: "TodoItem",
      members: [
        { memberName: "root", kind: "locator", access: "field" },
        { memberName: "archiveButton", kind: "locator", access: "field" },
      ],
      tools: [
        {
          methodName: "archive",
          toolName: "archive",
          description: "Archive this item.",
          authoredDescription: "Archive this item.",
          inputSchema: noArguments,
          parameters: [],
        },
      ],
    },
    {
      className: "ArchiveDialog",
      members: [
        { memberName: "root", kind: "locator", access: "field" },
        { memberName: "confirmButton", kind: "locator", access: "field" },
      ],
      tools: [],
    },
  ],
  tools: [
    {
      methodName: "addItem",
      toolName: "TodoPage.addItem",
      description: "Add an item to the list.",
      authoredDescription: "Add an item to the list.",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      },
      parameters: [
        { name: "text", optional: false, schema: { type: "string" } },
      ],
    },
  ],
};
