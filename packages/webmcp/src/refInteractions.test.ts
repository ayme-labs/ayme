// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Page } from "@playwright/test";

const {
  captureAriaSnapshot,
  getRegisteredPomStructure,
  requireAymeRuntimePage,
} = vi.hoisted(() => ({
  captureAriaSnapshot: vi.fn(),
  getRegisteredPomStructure: vi.fn(),
  requireAymeRuntimePage: vi.fn(),
}));

vi.mock("@ayme-dev/playwright-lite/internal", () => ({
  captureAriaSnapshot,
}));
vi.mock("./registry", () => ({
  getRegisteredPomStructure,
  requireAymeRuntimePage,
}));

import { AriaRefSchema } from "@ayme-dev/core/structural-observation";
import { getPageStateForDocument } from "./pageState";
import {
  clickPageStateRefTool,
  createRefInteractions,
  fillPageStateRefTool,
} from "./refInteractions";

const ref = AriaRefSchema.parse;

describe("Structural Ref interactions", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "document",
      document.implementation.createHTMLDocument("Ref interactions test")
    );
    document.body.innerHTML = '<button id="save">Save changes</button>';
    getRegisteredPomStructure.mockResolvedValue({
      roots: [],
      absentElements: [],
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("refreshes the public ARIA snapshot before clicking the current resolved ref", async () => {
    const button = document.querySelector("#save");
    if (!button) throw new Error("Expected the save button.");
    mockCapture(button, "e2");
    await getPageStateForDocument(document);
    const ariaSnapshot = vi
      .fn()
      .mockResolvedValue('- button "Save changes" [ref=e2]');
    const click = vi.fn().mockResolvedValue(undefined);
    const page = fakePage({ ariaSnapshot, click });

    await createRefInteractions(page).click(ref("e2"));

    expect(ariaSnapshot).toHaveBeenCalledWith({ mode: "ai" });
    expect(click).toHaveBeenCalledWith("aria-ref=e2");
    expect(ariaSnapshot.mock.invocationCallOrder[0]).toBeLessThan(
      click.mock.invocationCallOrder[0]!
    );
  });

  it("retargets a historical ref to the current ref before filling", async () => {
    const original = document.querySelector("#save");
    if (!original) throw new Error("Expected the original button.");
    mockCapture(original, "e2");
    await getPageStateForDocument(document);

    const replacement = document.createElement("input");
    replacement.id = "save";
    replacement.setAttribute("aria-label", "Save changes");
    original.replaceWith(replacement);
    mockCapture(replacement, "e4", "e3");

    const ariaSnapshot = vi
      .fn()
      .mockResolvedValue('textbox "Save changes" [ref=e4]');
    const fill = vi.fn().mockResolvedValue(undefined);
    const page = fakePage({ ariaSnapshot, fill });
    await createRefInteractions(page).fill(ref("e2"), "updated");

    expect(ariaSnapshot).toHaveBeenCalledWith({ mode: "ai" });
    expect(fill).toHaveBeenCalledWith("aria-ref=e4", "updated");
  });

  it("rejects an unknown ref without refreshing or acting", async () => {
    const button = document.querySelector("#save");
    if (!button) throw new Error("Expected the save button.");
    mockCapture(button, "e2");
    await getPageStateForDocument(document);

    const page = fakePage();
    await expect(
      createRefInteractions(page).click(ref("e999"))
    ).rejects.toThrow('Cannot click ref "e999": unknown-ref.');
    expect(page.ariaSnapshot).not.toHaveBeenCalled();
    expect(page.click).not.toHaveBeenCalled();
  });

  it("rejects a removed ref without refreshing or acting", async () => {
    const button = document.querySelector("#save");
    if (!button) throw new Error("Expected the save button.");
    mockCapture(button, "e2");
    await getPageStateForDocument(document);
    button.remove();
    captureAriaSnapshot.mockReturnValue({
      distilledText: "- generic [ref=e1]",
      fullText: "- generic [ref=e1]",
      refsByElement: new Map([[document.body, "e1"]]),
    });

    const page = fakePage();
    await expect(createRefInteractions(page).click(ref("e2"))).rejects.toThrow(
      'Cannot click ref "e2": removed.'
    );
    expect(page.ariaSnapshot).not.toHaveBeenCalled();
    expect(page.click).not.toHaveBeenCalled();
  });

  it("rejects an ambiguous ref without refreshing or acting", async () => {
    const button = document.querySelector("#save");
    if (!button) throw new Error("Expected the save button.");
    mockCapture(button, "e2");
    await getPageStateForDocument(document);

    const first = document.createElement("button");
    first.textContent = "Save changes";
    const second = document.createElement("button");
    second.textContent = "Save changes";
    document.body.replaceChildren(first, second);
    mockCapture(
      first,
      "e4",
      "e3",
      `- generic [ref=e3]:\n  - button "Save changes" [ref=e4]\n  - button "Save changes" [ref=e5]`,
      [
        [document.body, "e3"],
        [first, "e4"],
        [second, "e5"],
      ]
    );

    const page = fakePage();
    await expect(createRefInteractions(page).click(ref("e2"))).rejects.toThrow(
      'Cannot click ref "e2": ambiguous.'
    );
    expect(page.ariaSnapshot).not.toHaveBeenCalled();
    expect(page.click).not.toHaveBeenCalled();
  });

  it("rejects refs without an associated element", async () => {
    mockCapture(undefined, "e2");
    await getPageStateForDocument(document);

    const page = fakePage();
    await expect(createRefInteractions(page).click(ref("e2"))).rejects.toThrow(
      'Cannot click ref "e2": no-element.'
    );
    expect(page.ariaSnapshot).not.toHaveBeenCalled();
    expect(page.click).not.toHaveBeenCalled();
  });

  it("rejects synthetic refs as observation-only", async () => {
    const root = document.createElement("div");
    const button = document.querySelector("#save");
    if (!button) throw new Error("Expected the save button.");
    root.append(button);
    document.body.append(root);
    getRegisteredPomStructure.mockResolvedValue({
      roots: [{ label: "Page.root", element: root }],
      absentElements: [],
    });
    mockCapture(button, "e2");
    await getPageStateForDocument(document);

    const page = fakePage();
    await expect(createRefInteractions(page).click(ref("s_1"))).rejects.toThrow(
      'Cannot click ref "s_1": synthetic observation-only ref.'
    );
    expect(page.ariaSnapshot).not.toHaveBeenCalled();
    expect(page.click).not.toHaveBeenCalled();
  });

  it("publishes click and fill tool schemas and minimal successful results", async () => {
    const button = document.querySelector("#save");
    if (!button) throw new Error("Expected the save button.");
    mockCapture(button, "e2");
    await getPageStateForDocument(document);
    const ariaSnapshot = vi
      .fn()
      .mockResolvedValue('button "Save changes" [ref=e2]');
    const click = vi.fn().mockResolvedValue(undefined);
    const fill = vi.fn().mockResolvedValue(undefined);
    const page = fakePage({ ariaSnapshot, click, fill });
    requireAymeRuntimePage.mockReturnValue(page);

    expect(clickPageStateRefTool.inputSchema).toEqual({
      type: "object",
      properties: { ref: { type: "string" } },
      required: ["ref"],
      additionalProperties: false,
    });
    expect(fillPageStateRefTool.inputSchema).toEqual({
      type: "object",
      properties: { ref: { type: "string" }, value: { type: "string" } },
      required: ["ref", "value"],
      additionalProperties: false,
    });

    await expect(clickPageStateRefTool.execute({ ref: "e2" })).resolves.toEqual(
      {
        ok: true,
      }
    );
    await expect(
      fillPageStateRefTool.execute({ ref: "e2", value: "updated" })
    ).resolves.toEqual({ ok: true });
    expect(click).toHaveBeenCalledWith("aria-ref=e2");
    expect(fill).toHaveBeenCalledWith("aria-ref=e2", "updated");
  });
});

function fakePage(
  overrides: {
    ariaSnapshot?: ReturnType<typeof vi.fn>;
    click?: ReturnType<typeof vi.fn>;
    fill?: ReturnType<typeof vi.fn>;
  } = {}
): Page {
  return {
    ariaSnapshot: overrides.ariaSnapshot ?? vi.fn().mockResolvedValue(""),
    click: overrides.click ?? vi.fn().mockResolvedValue(undefined),
    fill: overrides.fill ?? vi.fn().mockResolvedValue(undefined),
  } as unknown as Page;
}

function mockCapture(
  element: Element | undefined,
  elementRef: string,
  rootRef = "e1",
  tree?: string,
  refs: [Element, string][] = element
    ? [
        [document.body, rootRef],
        [element, elementRef],
      ]
    : [[document.body, rootRef]]
) {
  const renderedTree =
    tree ??
    `- generic [ref=${rootRef}]:\n  - button "Save changes" [ref=${elementRef}]`;
  captureAriaSnapshot.mockReturnValue({
    distilledText: renderedTree,
    fullText: renderedTree,
    refsByElement: new Map(refs),
  });
}
