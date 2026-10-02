import { afterEach, describe, expect, it, vi } from "vitest";

import { createPage } from "./browserPage";
import {
  createAymeRuntime,
  registerCompiledPom,
  createPageRegistration,
  listRegisteredPomTools,
  probeRegisteredPomMembers,
} from "./registry";
import type { PomManifest } from "./contracts";

const action = (methodName: string, description: string) => ({
  methodName,
  toolName: methodName,
  description,
  inputSchema: {
    type: "object" as const,
    properties: {},
    required: [] as string[],
    additionalProperties: false,
  },
  parameters: [],
  returnPoms: [],
});

function refInPageState(text: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(
    new RegExp(`(?:^|\\s)((?:e|s_)\\w+) ${escaped}(?:\\b|:)`, "m")
  );
  if (!match?.[1])
    throw new Error(`No ref found for "${label}" in page state.`);
  return match[1];
}

describe("collection instances targeted by ref", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("targets the second of three instances by ref", async () => {
    document.body.innerHTML = `
      <ul>
        <li id="item-0"><button>Archive item-0</button></li>
        <li id="item-1"><button>Archive item-1</button></li>
        <li id="item-2"><button>Archive item-2</button></li>
      </ul>
    `;
    const page = createPage();
    const runtime = createAymeRuntime(page);
    try {
      const archiveFns = [vi.fn(), vi.fn(), vi.fn()];
      const items = [0, 1, 2].map((i) => ({
        root: page.locator(`#item-${i}`),
        archive: archiveFns[i]!,
      }));

      class ItemsPage {
        readonly items = items;
      }

      const manifest: PomManifest = {
        className: "ItemsPage",
        tools: [],
        members: [
          {
            memberName: "items",
            kind: "component",
            access: "field",
            componentClassName: "Item",
            collection: true,
          },
        ],
        components: [
          {
            className: "Item",
            members: [{ memberName: "root", kind: "locator", access: "field" }],
            tools: [action("archive", "Archive this item.")],
          },
        ],
      };

      registerCompiledPom(ItemsPage, manifest);
      const registration = createPageRegistration(ItemsPage);
      await probeRegisteredPomMembers();

      const tools = listRegisteredPomTools();
      const archiveTool = tools.find(
        (t) => t.name === "ItemsPage.items.archive"
      );
      if (!archiveTool) throw new Error("Expected archive tool.");

      const { getPageStateForDocument } = await import("./pageState");
      const state = await getPageStateForDocument(document);
      const ref = refInPageState(state.text, "ItemsPage.items[1]");

      await archiveTool.execute({ ref, args: {} });

      expect(archiveFns[0]).not.toHaveBeenCalled();
      expect(archiveFns[1]).toHaveBeenCalledOnce();
      expect(archiveFns[2]).not.toHaveBeenCalled();

      registration.dispose();
    } finally {
      runtime.dispose();
    }
  });

  it("resolves an earlier ref after a re-render removes the first instance", async () => {
    document.body.innerHTML = `
      <ul>
        <li id="item-0"><button>Archive item-0</button></li>
        <li id="item-1"><button>Archive item-1</button></li>
        <li id="item-2"><button>Archive item-2</button></li>
      </ul>
    `;
    const page = createPage();
    const runtime = createAymeRuntime(page);
    try {
      const archiveFns = [vi.fn(), vi.fn(), vi.fn()];
      const items = [0, 1, 2].map((i) => ({
        root: page.locator(`#item-${i}`),
        archive: archiveFns[i]!,
      }));

      class ItemsPage {
        readonly items = items;
      }

      registerCompiledPom(ItemsPage, {
        className: "ItemsPage",
        tools: [],
        members: [
          {
            memberName: "items",
            kind: "component",
            access: "field",
            componentClassName: "Item",
            collection: true,
          },
        ],
        components: [
          {
            className: "Item",
            members: [{ memberName: "root", kind: "locator", access: "field" }],
            tools: [action("archive", "Archive this item.")],
          },
        ],
      });
      const registration = createPageRegistration(ItemsPage);
      await probeRegisteredPomMembers();

      const tools = listRegisteredPomTools();
      const archiveTool = tools.find(
        (t) => t.name === "ItemsPage.items.archive"
      );
      if (!archiveTool) throw new Error("Expected archive tool.");

      // Capture state and get ref for item-1.
      const { getPageStateForDocument } = await import("./pageState");
      const state = await getPageStateForDocument(document);
      const ref = refInPageState(state.text, "ItemsPage.items[1]");

      // Remove item-0 (the first instance) between look and act.
      document.querySelector("#item-0")?.remove();

      // The earlier ref should still resolve to item-1's element (ADR-0028).
      await archiveTool.execute({ ref, args: {} });

      expect(archiveFns[0]).not.toHaveBeenCalled();
      expect(archiveFns[1]).toHaveBeenCalledOnce();
      expect(archiveFns[2]).not.toHaveBeenCalled();

      registration.dispose();
    } finally {
      runtime.dispose();
    }
  });

  it("fails with a clear error for a stale ref whose instance was removed", async () => {
    document.body.innerHTML = `
      <ul>
        <li id="item-0"><button>Archive item-0</button></li>
        <li id="item-1"><button>Archive item-1</button></li>
      </ul>
    `;
    const page = createPage();
    const runtime = createAymeRuntime(page);
    try {
      const archiveFns = [vi.fn(), vi.fn()];
      const items = [0, 1].map((i) => ({
        root: page.locator(`#item-${i}`),
        archive: archiveFns[i]!,
      }));

      class ItemsPage {
        readonly items = items;
      }

      registerCompiledPom(ItemsPage, {
        className: "ItemsPage",
        tools: [],
        members: [
          {
            memberName: "items",
            kind: "component",
            access: "field",
            componentClassName: "Item",
            collection: true,
          },
        ],
        components: [
          {
            className: "Item",
            members: [{ memberName: "root", kind: "locator", access: "field" }],
            tools: [action("archive", "Archive this item.")],
          },
        ],
      });
      const registration = createPageRegistration(ItemsPage);
      await probeRegisteredPomMembers();

      const tools = listRegisteredPomTools();
      const archiveTool = tools.find(
        (t) => t.name === "ItemsPage.items.archive"
      );
      if (!archiveTool) throw new Error("Expected archive tool.");

      // Capture state and get ref for item-1.
      const { getPageStateForDocument } = await import("./pageState");
      const state = await getPageStateForDocument(document);
      const ref = refInPageState(state.text, "ItemsPage.items[1]");

      // Remove item-1 entirely from the DOM.
      document.querySelector("#item-1")?.remove();

      await expect(archiveTool.execute({ ref, args: {} })).rejects.toThrow(
        /does not match a present instance at ItemsPage\.items \(tool ItemsPage\.items\.archive\)/
      );

      expect(archiveFns[0]).not.toHaveBeenCalled();
      expect(archiveFns[1]).not.toHaveBeenCalled();

      registration.dispose();
    } finally {
      runtime.dispose();
    }
  });

  it("targets an instance in a nested collection with a single ref", async () => {
    document.body.innerHTML = `
      <div id="group-0">
        <ul>
          <li id="item-0-0"><button>Action</button></li>
          <li id="item-0-1"><button>Action</button></li>
        </ul>
      </div>
      <div id="group-1">
        <ul>
          <li id="item-1-0"><button>Action</button></li>
        </ul>
      </div>
    `;
    const page = createPage();
    const runtime = createAymeRuntime(page);
    try {
      const actionFns = [[vi.fn(), vi.fn()], [vi.fn()]];
      const groups = [0, 1].map((g) => ({
        root: page.locator(`#group-${g}`),
        items: [0, ...(g === 0 ? [1] : [])].map((i) => ({
          root: page.locator(`#item-${g}-${i}`),
          doAction: actionFns[g]![i]!,
        })),
      }));

      class GroupsPage {
        readonly groups = groups;
      }

      registerCompiledPom(GroupsPage, {
        className: "GroupsPage",
        tools: [],
        members: [
          {
            memberName: "groups",
            kind: "component",
            access: "field",
            componentClassName: "Group",
            collection: true,
          },
        ],
        components: [
          {
            className: "Group",
            members: [
              { memberName: "root", kind: "locator", access: "field" },
              {
                memberName: "items",
                kind: "component",
                access: "field",
                componentClassName: "Item",
                collection: true,
              },
            ],
            tools: [],
          },
          {
            className: "Item",
            members: [{ memberName: "root", kind: "locator", access: "field" }],
            tools: [action("doAction", "Perform action.")],
          },
        ],
      });
      const registration = createPageRegistration(GroupsPage);
      await probeRegisteredPomMembers();

      const tools = listRegisteredPomTools();
      const doActionTool = tools.find(
        (t) => t.name === "GroupsPage.groups.items.doAction"
      );
      if (!doActionTool) throw new Error("Expected doAction tool.");

      // Capture state and get ref for the second item in the first group.
      const { getPageStateForDocument } = await import("./pageState");
      const state = await getPageStateForDocument(document);
      const ref = refInPageState(state.text, "GroupsPage.groups[0].items[1]");

      await doActionTool.execute({ ref, args: {} });

      expect(actionFns[0]![0]).not.toHaveBeenCalled();
      expect(actionFns[0]![1]).toHaveBeenCalledOnce();
      expect(actionFns[1]![0]).not.toHaveBeenCalled();

      registration.dispose();
    } finally {
      runtime.dispose();
    }
  });

  it("resolves a collection → singular-child tool path", async () => {
    document.body.innerHTML = `
      <div id="item-0"><button id="child-0">Open</button></div>
      <div id="item-1"><button id="child-1">Open</button></div>
    `;
    const page = createPage();
    const runtime = createAymeRuntime(page);
    try {
      const openFns = [vi.fn(), vi.fn()];
      const items = [0, 1].map((i) => ({
        root: page.locator(`#item-${i}`),
        child: {
          root: page.locator(`#child-${i}`),
          open: openFns[i]!,
        },
      }));

      class ItemsPage {
        readonly items = items;
      }

      registerCompiledPom(ItemsPage, {
        className: "ItemsPage",
        tools: [],
        members: [
          {
            memberName: "items",
            kind: "component",
            access: "field",
            componentClassName: "Item",
            collection: true,
          },
        ],
        components: [
          {
            className: "Item",
            members: [
              { memberName: "root", kind: "locator", access: "field" },
              {
                memberName: "child",
                kind: "component",
                access: "field",
                componentClassName: "Child",
                collection: false,
              },
            ],
            tools: [],
          },
          {
            className: "Child",
            members: [{ memberName: "root", kind: "locator", access: "field" }],
            tools: [action("open", "Open this child.")],
          },
        ],
      });
      const registration = createPageRegistration(ItemsPage);
      await probeRegisteredPomMembers();

      const tools = listRegisteredPomTools();
      const openTool = tools.find(
        (t) => t.name === "ItemsPage.items.child.open"
      );
      if (!openTool) throw new Error("Expected open tool.");

      const { getPageStateForDocument } = await import("./pageState");
      const state = await getPageStateForDocument(document);
      const ref = refInPageState(state.text, "ItemsPage.items[1]");

      await openTool.execute({ ref, args: {} });

      expect(openFns[0]).not.toHaveBeenCalled();
      expect(openFns[1]).toHaveBeenCalledOnce();

      registration.dispose();
    } finally {
      runtime.dispose();
    }
  });
});
