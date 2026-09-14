// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getPageStateForDocument, getPomDefinitions } = vi.hoisted(() => ({
  getPageStateForDocument: vi.fn(),
  getPomDefinitions: vi.fn(),
}));

vi.mock("./pageState", () => ({ getPageStateForDocument }));
vi.mock("./pomDefinitions", () => ({ getPomDefinitions }));

import { getPageContextForDocument, getPageContextTool } from "./pageContext";

describe("get_page_context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "document",
      document.implementation.createHTMLDocument("Page context test")
    );
    getPageStateForDocument.mockResolvedValue({
      text: '- e1 button "Save changes"',
      resolve: vi.fn(),
    });
    getPomDefinitions.mockReturnValue({
      definitions: [
        {
          name: "ProfileMenu",
          description: "The user profile menu.",
          children: [],
          actions: [],
        },
      ],
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("combines current structure and POM definitions while retaining ref resolution", async () => {
    const resolve = vi.fn();
    getPageStateForDocument.mockResolvedValue({
      text: '- e1 button "Save changes"',
      resolve,
    });
    const context = await getPageContextForDocument(
      document,
      "ProfileMenu",
      "DocumentPage"
    );

    expect(context.structure).toBe('- e1 button "Save changes"');
    expect(context.pomDefinitions).toEqual([
      {
        name: "ProfileMenu",
        description: "The user profile menu.",
        children: [],
        actions: [],
      },
    ]);
    expect(context.resolve).toBe(resolve);
    expect(getPomDefinitions).toHaveBeenCalledWith(
      "ProfileMenu",
      "DocumentPage"
    );
  });

  it("returns a JSON-safe context payload and forwards a named definition filter", async () => {
    await expect(
      getPageContextTool.execute({ names: ["ProfileMenu"] })
    ).resolves.toEqual({
      structure: '- e1 button "Save changes"',
      pomDefinitions: "POM ProfileMenu // The user profile menu.",
    });
    expect(getPomDefinitions).toHaveBeenCalledWith("ProfileMenu");
  });

  it("renders child members and action signatures without empty sections", async () => {
    getPomDefinitions.mockReturnValue({
      definitions: [
        {
          name: "AppTopBar",
          description: "Application top bar.",
          children: [
            { memberName: "helpButton", kind: "locator", access: "field" },
            {
              memberName: "helpMenu",
              kind: "component",
              access: "field",
              componentClassName: "AppTopBarHelpMenu",
              collection: false,
            },
            {
              memberName: "notifications",
              kind: "component",
              access: "getter",
              componentClassName: "NotificationItem",
              collection: true,
            },
          ],
          actions: [
            {
              name: "openHelp",
              description: "Open the help menu.",
              inputSchema: {
                type: "object",
                properties: {},
                required: [],
                additionalProperties: false,
              },
              returnPoms: ["AppTopBarHelpMenu"],
            },
            {
              name: "openDocument",
              description: "Open a document.",
              inputSchema: {
                type: "object",
                properties: { documentName: { type: "string" } },
                required: ["documentName"],
                additionalProperties: false,
              },
              returnPoms: ["DocumentPage"],
            },
            {
              name: "refresh",
              inputSchema: {
                type: "object",
                properties: {},
                required: [],
                additionalProperties: false,
              },
              returnPoms: [],
            },
          ],
        },
        {
          name: "AppTopBarHelpMenu",
          children: [],
          actions: [
            {
              name: "close",
              description: "Close the help menu.",
              inputSchema: {
                type: "object",
                properties: {},
                required: [],
                additionalProperties: false,
              },
              returnPoms: ["AppTopBarHelpMenu"],
            },
          ],
        },
      ],
    });

    await expect(getPageContextTool.execute({})).resolves.toEqual({
      structure: '- e1 button "Save changes"',
      pomDefinitions: `POM AppTopBar // Application top bar.
  helpButton
  helpMenu: AppTopBarHelpMenu
  notifications: NotificationItem[]

  // Open the help menu.
  openHelp(): AppTopBarHelpMenu

  // Open a document.
  openDocument(documentName: string): DocumentPage

  refresh()

POM AppTopBarHelpMenu
  // Close the help menu.
  close(): this`,
    });
  });
});
