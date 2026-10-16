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
vi.mock("./registry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./registry")>()),
  getRegisteredPomStructure,
  requireAymeRuntimePage,
}));

const waitForSettled = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ stable: true })
);
vi.mock("@ayme-dev/core/structural-observation", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@ayme-dev/core/structural-observation")
  >()),
  waitForSettled,
}));

import {
  AriaRefSchema,
  refFromSelector,
} from "@ayme-dev/core/structural-observation";
import { RefResolutionError } from "./errors";
import { getPageStateForDocument, latestPageStateElement } from "./pageState";
import { listPublishedBrowserTools } from "./browserTools";
import { ayme, runContext } from "./agentCalls.testSupport";

const ref = AriaRefSchema.parse;
const clickRef = ayme.click;
const fillRef = ayme.fill;

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
    waitForSettled.mockResolvedValue({ stable: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("clicks the current resolved ref through Ayme's selector engine", async () => {
    const button = document.querySelector("#save");
    if (!button) throw new Error("Expected the save button.");
    mockCapture(button, "e2");
    await getPageStateForDocument(document);
    const click = vi.fn().mockResolvedValue(undefined);
    usePage({ click });

    await clickRef(ref("e2"));

    expect(click).toHaveBeenCalledWith("ayme-ref=e2");
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

    const fill = vi.fn().mockResolvedValue(undefined);
    usePage({ fill });
    await fillRef(ref("e2"), "updated");

    expect(fill).toHaveBeenCalledWith("ayme-ref=e4", "updated");
  });

  it("rejects an unknown ref without acting", async () => {
    const button = document.querySelector("#save");
    if (!button) throw new Error("Expected the save button.");
    mockCapture(button, "e2");
    await getPageStateForDocument(document);

    const page = usePage();
    await expect(clickRef(ref("e999"))).rejects.toThrow(
      'Cannot click ref "e999": no snapshot issued it.'
    );
    expect(page.click).not.toHaveBeenCalled();
  });

  it("rejects a removed ref without acting", async () => {
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

    const page = usePage();
    await expect(clickRef(ref("e2"))).rejects.toThrow(
      'Cannot click ref "e2": it is no longer on the page.'
    );
    await expect(clickRef(ref("e2"))).rejects.toBeInstanceOf(
      RefResolutionError
    );
    expect(page.click).not.toHaveBeenCalled();
  });

  it("rejects an ambiguous ref without acting", async () => {
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

    const page = usePage();
    await expect(clickRef(ref("e2"))).rejects.toThrow(
      'Cannot click ref "e2": it cannot be matched unambiguously to the current page.'
    );
    expect(page.click).not.toHaveBeenCalled();
  });

  it("rejects refs without an associated element", async () => {
    mockCapture(undefined, "e2");
    await getPageStateForDocument(document);

    const page = usePage();
    await expect(clickRef(ref("e2"))).rejects.toThrow(
      'Cannot click ref "e2": it has no element on the page now.'
    );
    expect(page.click).not.toHaveBeenCalled();
  });

  it("clicks a Page Object Root's synthetic ref like any other", async () => {
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
    const { text } = await getPageStateForDocument(document);
    const rootRef = text.match(/(s_\w+) Page\.root\b/)?.[1];
    if (!rootRef) throw new Error("Expected a synthetic ref for the root.");
    // At click time the selector names the root's current ref, the one the
    // engine resolves in the latest capture.
    const clicked: { selector?: string; element?: Element } = {};
    const click = vi.fn(async (selector: string) => {
      clicked.selector = selector;
      clicked.element = latestPageStateElement(
        document,
        refFromSelector(selector)!
      );
    });
    usePage({ click });

    await clickRef(ref(rootRef));

    expect(clicked.selector).toMatch(/^ayme-ref=s_\w+$/);
    expect(clicked.element).toBe(root);
  });

  it("reports page_changed and settled after act, wait, capture and reconcile", async () => {
    const button = document.querySelector("#save");
    if (!button) throw new Error("Expected the save button.");
    mockCapture(button, "e2");
    await getPageStateForDocument(document);

    const click = vi.fn().mockResolvedValue(undefined);
    usePage({ click });

    await expect(clickRef(ref("e2"))).resolves.toEqual({
      page_changed: false,
      settled: true,
    });
    expect(waitForSettled).toHaveBeenCalledOnce();
  });

  it("reports settled false when the quiet window deadline passes first", async () => {
    const button = document.querySelector("#save");
    if (!button) throw new Error("Expected the save button.");
    mockCapture(button, "e2");
    await getPageStateForDocument(document);
    waitForSettled.mockResolvedValueOnce({ stable: false });

    usePage({ click: vi.fn().mockResolvedValue(undefined) });

    await expect(clickRef(ref("e2"))).resolves.toEqual({
      page_changed: false,
      settled: false,
    });
  });

  it("runs the published click and fill with a Structural Ref target", async () => {
    const button = document.querySelector("#save");
    if (!button) throw new Error("Expected the save button.");
    mockCapture(button, "e2");
    await getPageStateForDocument(document);
    const click = vi.fn().mockResolvedValue(undefined);
    const fill = vi.fn().mockResolvedValue(undefined);
    usePage({ click, fill });
    const published = (name: string) =>
      listPublishedBrowserTools().find((tool) => tool.name === name)!;

    await expect(
      published("click").execute({ target: "e2" }, runContext())
    ).resolves.toEqual({ page_changed: false, settled: true });
    await expect(
      published("fill").execute({ target: "e2", text: "updated" }, runContext())
    ).resolves.toEqual({ page_changed: false, settled: true });
    expect(click).toHaveBeenCalledWith("ayme-ref=e2");
    expect(fill).toHaveBeenCalledWith("ayme-ref=e2", "updated");
  });
});

/** Make a fake Playwright Page the Ayme runtime hands to single-element tool actions. */
function usePage(
  overrides: {
    click?: ReturnType<typeof vi.fn>;
    fill?: ReturnType<typeof vi.fn>;
  } = {}
): Page {
  // A locator's action reports the selector it acts on, as `page.click` would.
  type Act = (...args: unknown[]) => unknown;
  const click = (overrides.click ??
    vi.fn().mockResolvedValue(undefined)) as unknown as Act;
  const fill = (overrides.fill ??
    vi.fn().mockResolvedValue(undefined)) as unknown as Act;
  const page = {
    click,
    fill,
    locator: (selector: string) => ({
      click: () => click(selector),
      fill: (value: string) => fill(selector, value),
    }),
  } as unknown as Page;
  requireAymeRuntimePage.mockReturnValue(page);
  return page;
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
