// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { captureAriaSnapshot, listRegisteredPomRoots } = vi.hoisted(() => ({
  captureAriaSnapshot: vi.fn(),
  listRegisteredPomRoots: vi.fn(),
}));

vi.mock("@ayme-dev/playwright-lite/internal", () => ({ captureAriaSnapshot }));
vi.mock("./registry", () => ({
  getRegisteredPomStructure: async () => ({
    roots: await listRegisteredPomRoots(),
    absentElements: [],
  }),
}));

import { AriaRefSchema } from "@ayme-dev/core/structural-observation";
import {
  configurePageStateIgnore,
  getPageStateCaptureForDocument,
  getPageStateTool,
} from "./pageState";
import ayme from "./index";

const ref = AriaRefSchema.parse;

describe("get_page_state", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "document",
      document.implementation.createHTMLDocument("Page state test")
    );
    document.body.innerHTML = `
      <button id="captured">Captured omitted</button>
      <div id="synthetic" aria-label="Synthetic root"></div>
      <button id="hidden" hidden>Hidden root</button>
    `;
    vi.clearAllMocks();
  });

  afterEach(() => {
    configurePageStateIgnore(undefined);
    vi.unstubAllGlobals();
  });

  it("describes structural refs and root POM decoration", () => {
    expect(getPageStateTool.description).toBe(
      "Return the top-level structural page state, decorated with root POM labels. Real nodes use Playwright refs; synthetic POM roots use observation-only synthetic refs. Capture is limited to the top-level document."
    );
  });

  it("decorates a retained real POM root and omits unrepresented leaf and foreign roots", async () => {
    const captured = document.querySelector("#captured");
    const hidden = document.querySelector("#hidden");
    if (!captured || !hidden) throw new Error("Missing test roots.");
    const foreignDocument = document.implementation.createHTMLDocument("frame");
    const foreign = foreignDocument.body.appendChild(
      foreignDocument.createElement("button")
    );

    captureAriaSnapshot.mockReturnValue({
      distilledText: `
- generic [ref=e1]:
  - button "Captured omitted" [ref=e2]
`.trim(),
      fullText: `
- generic [ref=e1]:
  - button "Captured omitted" [ref=e2]
`.trim(),
      refsByElement: new Map([
        [document.body, "e1"],
        [captured, "e2"],
        [hidden, "e3"],
        [foreign, "e4"],
      ]),
    });
    listRegisteredPomRoots.mockResolvedValue([
      { label: "ListPage.captured", element: captured },
      { label: "ListPage.hidden", element: hidden },
      { label: "ListPage.foreign", element: foreign },
    ]);

    await expect(getPageStateTool.execute()).resolves.toMatchInlineSnapshot(`
      "- e1:
        - e2 ListPage.captured "Captured omitted""
    `);
  });

  it("reparents an omitted POM root without duplicating a distilled descendant", async () => {
    document.body.innerHTML = `
      <div id="pom-root">
        <button id="child">Nested child</button>
      </div>
    `;
    const pomRoot = document.querySelector("#pom-root");
    const child = document.querySelector("#child");
    if (!pomRoot || !child) throw new Error("Missing test roots.");

    captureAriaSnapshot.mockReturnValue({
      distilledText: `
- generic [ref=e1]:
  - button "Nested child" [ref=e3]
`.trim(),
      fullText: `
- generic [ref=e1]:
  - generic [ref=e2]:
    - button "Nested child" [ref=e3]
`.trim(),
      refsByElement: new Map([
        [document.body, "e1"],
        [pomRoot, "e2"],
        [child, "e3"],
      ]),
    });
    listRegisteredPomRoots.mockResolvedValue([
      { label: "ListPage.item", element: pomRoot },
    ]);

    await expect(getPageStateTool.execute()).resolves.toMatchInlineSnapshot(`
      "- e1:
        - e2 ListPage.item:
          - e3 button "Nested child""
    `);
  });

  it("restores an omitted POM root at its distilled descendant's position", async () => {
    document.body.innerHTML = `
      <button id="preceding">Preceding</button>
      <div id="pom-root"><button id="child">Nested child</button></div>
      <button id="following">Following</button>
    `;
    const preceding = document.querySelector("#preceding");
    const pomRoot = document.querySelector("#pom-root");
    const child = document.querySelector("#child");
    const following = document.querySelector("#following");
    if (!preceding || !pomRoot || !child || !following)
      throw new Error("Missing test roots.");

    captureAriaSnapshot.mockReturnValue({
      distilledText: `
- generic [ref=e1]:
  - button "Preceding" [ref=e2]
  - button "Nested child" [ref=e4]
  - button "Following" [ref=e5]
`.trim(),
      fullText: `
- generic [ref=e1]:
  - button "Preceding" [ref=e2]
  - generic [ref=e3]:
    - button "Nested child" [ref=e4]
  - button "Following" [ref=e5]
`.trim(),
      refsByElement: new Map([
        [document.body, "e1"],
        [preceding, "e2"],
        [pomRoot, "e3"],
        [child, "e4"],
        [following, "e5"],
      ]),
    });
    listRegisteredPomRoots.mockResolvedValue([
      { label: "ListPage.item", element: pomRoot },
    ]);

    await expect(getPageStateTool.execute()).resolves.toMatchInlineSnapshot(`
      "- e1:
        - e2 button "Preceding"
        - e3 ListPage.item:
          - e4 button "Nested child"
        - e5 button "Following""
    `);
  });

  it("mints a synthetic ref for an anchored omitted root with a retained descendant", async () => {
    document.body.innerHTML = `
      <div id="pom-root" role="region" aria-label="Synthetic root">
        Synthetic visible <span aria-hidden="true">Hidden text</span>
        <button id="child">Nested child</button>
      </div>
    `;
    const pomRoot = document.querySelector("#pom-root");
    const child = document.querySelector("#child");
    if (!pomRoot || !child) throw new Error("Missing test roots.");

    captureAriaSnapshot.mockReturnValue({
      distilledText: `
- generic [ref=e1]:
  - button "Nested child" [ref=e3]
`.trim(),
      fullText: `
- generic [ref=e1]:
  - generic:
    - button "Nested child" [ref=e3]
`.trim(),
      refsByElement: new Map([
        [document.body, "e1"],
        [child, "e3"],
      ]),
    });
    listRegisteredPomRoots.mockResolvedValue([
      { label: "ListPage.synthetic", element: pomRoot },
    ]);

    await expect(getPageStateTool.execute()).resolves.toMatchInlineSnapshot(`
      "- e1:
        - s_1 ListPage.synthetic:
          - e3 button "Nested child""
    `);
  });

  it("coalesces two labels on the same omitted element into one synthetic ref", async () => {
    document.body.innerHTML = `
      <div id="pom-root" aria-label="Shared root">
        <button id="child">Child</button>
      </div>
    `;
    const pomRoot = document.querySelector("#pom-root");
    const child = document.querySelector("#child");
    if (!pomRoot || !child) throw new Error("Missing test roots.");

    captureAriaSnapshot.mockReturnValue({
      distilledText: `
- generic [ref=e1]:
  - button "Child" [ref=e2]
`.trim(),
      fullText: `
- generic [ref=e1]:
  - generic:
    - button "Child" [ref=e2]
`.trim(),
      refsByElement: new Map([
        [document.body, "e1"],
        [child, "e2"],
      ]),
    });
    listRegisteredPomRoots.mockResolvedValue([
      { label: "PageA.root", element: pomRoot },
      { label: "PageB.root", element: pomRoot },
    ]);

    await expect(getPageStateTool.execute()).resolves.toMatchInlineSnapshot(`
      "- e1:
        - s_1:
          - /pom: ["PageA.root","PageB.root"]
          - e2 button "Child""
    `);
  });

  it.each([
    ["first-first", ["First.root", "Second.root"]],
    ["second-first", ["Second.root", "First.root"]],
  ])(
    "keeps sibling synthetic roots in full-tree order when registered %s",
    async (_registrationOrder, labels) => {
      document.body.innerHTML = `
        <div id="first"><button id="first-child">First</button></div>
        <div id="second"><button id="second-child">Second</button></div>
      `;
      const first = document.querySelector("#first");
      const second = document.querySelector("#second");
      const firstChild = document.querySelector("#first-child");
      const secondChild = document.querySelector("#second-child");
      if (!first || !second || !firstChild || !secondChild)
        throw new Error("Missing test roots.");

      captureAriaSnapshot.mockReturnValue({
        distilledText: `
- generic [ref=e1]:
  - button "First" [ref=e2]
  - button "Second" [ref=e3]
`.trim(),
        fullText: `
- generic [ref=e1]:
  - generic:
    - button "First" [ref=e2]
  - generic:
    - button "Second" [ref=e3]
`.trim(),
        refsByElement: new Map([
          [document.body, "e1"],
          [firstChild, "e2"],
          [secondChild, "e3"],
        ]),
      });
      const roots = new Map([
        ["First.root", first],
        ["Second.root", second],
      ]);
      listRegisteredPomRoots.mockResolvedValue(
        labels.map((label) => ({ label, element: roots.get(label)! }))
      );

      const output = await getPageStateTool.execute();

      if (_registrationOrder === "first-first") {
        expect(output).toMatchInlineSnapshot(`
          "- e1:
            - s_1 First.root:
              - e2 button "First"
            - s_2 Second.root:
              - e3 button "Second""
        `);
      } else {
        expect(output).toMatchInlineSnapshot(`
          "- e1:
            - s_2 First.root:
              - e2 button "First"
            - s_1 Second.root:
              - e3 button "Second""
        `);
      }
    }
  );

  it("deduplicates identical labels on one omitted element", async () => {
    document.body.innerHTML = `
      <div id="pom-root"><button id="child">Child</button></div>
    `;
    const pomRoot = document.querySelector("#pom-root");
    const child = document.querySelector("#child");
    if (!pomRoot || !child) throw new Error("Missing test roots.");

    captureAriaSnapshot.mockReturnValue({
      distilledText: `
- generic [ref=e1]:
  - button "Child" [ref=e2]
`.trim(),
      fullText: `
- generic [ref=e1]:
  - generic:
    - button "Child" [ref=e2]
`.trim(),
      refsByElement: new Map([
        [document.body, "e1"],
        [child, "e2"],
      ]),
    });
    listRegisteredPomRoots.mockResolvedValue([
      { label: "Page.root", element: pomRoot },
      { label: "Page.root", element: pomRoot },
    ]);

    await expect(getPageStateTool.execute()).resolves.toMatchInlineSnapshot(`
      "- e1:
        - s_1 Page.root:
          - e2 button "Child""
    `);
  });

  it("nests outer and inner ref-less roots even when registered inner-first with an unrelated root between them", async () => {
    // The unrelated root is nested under two extra non-POM wrapper divs so
    // its absolute DOM depth exceeds the inner POM root's depth, proving
    // that the sort uses POM containment depth rather than DOM ancestry.
    document.body.innerHTML = `
      <div id="outer" aria-label="Outer">
        <div id="inner" aria-label="Inner">
          <button id="child">Leaf</button>
        </div>
      </div>
      <div><div><div id="unrelated" aria-label="Unrelated">
        <button id="other">Other</button>
      </div></div></div>
    `;
    const outer = document.querySelector("#outer");
    const inner = document.querySelector("#inner");
    const child = document.querySelector("#child");
    const unrelated = document.querySelector("#unrelated");
    const other = document.querySelector("#other");
    if (!outer || !inner || !child || !unrelated || !other)
      throw new Error("Missing test roots.");

    captureAriaSnapshot.mockReturnValue({
      distilledText: `
- generic [ref=e1]:
  - button "Leaf" [ref=e2]
  - button "Other" [ref=e3]
`.trim(),
      fullText: `
- generic [ref=e1]:
  - generic:
    - generic:
      - button "Leaf" [ref=e2]
  - generic:
    - generic:
      - generic:
        - button "Other" [ref=e3]
`.trim(),
      refsByElement: new Map([
        [document.body, "e1"],
        [child, "e2"],
        [other, "e3"],
      ]),
    });
    // Registrations arrive inner-first with unrelated between inner and outer.
    listRegisteredPomRoots.mockResolvedValue([
      { label: "Inner.root", element: inner },
      { label: "Unrelated.root", element: unrelated },
      { label: "Outer.root", element: outer },
    ]);

    // Unrelated (POM depth 0, reg idx 1) is processed before outer
    // (POM depth 0, reg idx 2), while outer still precedes inner (POM depth 1).
    await expect(getPageStateTool.execute()).resolves.toMatchInlineSnapshot(`
      "- e1:
        - s_2 Outer.root:
          - s_3 Inner.root:
            - e2 button "Leaf"
        - s_1 Unrelated.root:
          - e3 button "Other""
    `);
  });

  it("resolves root candidates before capture and correlates only those candidates", async () => {
    document.body.innerHTML = '<button id="pre-capture">Pre-capture</button>';
    const preCaptureRoot = document.querySelector("#pre-capture");
    if (!preCaptureRoot) throw new Error("Missing pre-capture root.");
    let rootsResolved = false;

    listRegisteredPomRoots.mockImplementation(async () => {
      await Promise.resolve();
      rootsResolved = true;
      document.body.insertAdjacentHTML(
        "beforeend",
        '<button id="post-capture">Post-capture</button>'
      );
      return [{ label: "ListPage.preCapture", element: preCaptureRoot }];
    });
    captureAriaSnapshot.mockImplementation(() => {
      expect(rootsResolved).toBe(true);
      const postCaptureRoot = document.querySelector("#post-capture");
      if (!postCaptureRoot) throw new Error("Missing post-capture root.");
      return {
        distilledText: `
- generic [ref=e1]:
  - button "Pre-capture" [ref=e2]
  - button "Post-capture" [ref=e3]
`.trim(),
        fullText: `
- generic [ref=e1]:
  - button "Pre-capture" [ref=e2]
  - button "Post-capture" [ref=e3]
`.trim(),
        refsByElement: new Map([
          [document.body, "e1"],
          [preCaptureRoot, "e2"],
          [postCaptureRoot, "e3"],
        ]),
      };
    });

    await expect(getPageStateTool.execute()).resolves.toMatchInlineSnapshot(`
      "- e1:
        - e2 ListPage.preCapture "Pre-capture"
        - e3 button "Post-capture""
    `);
  });

  it("shares its session with Ayme when a structural ref is retargeted", async () => {
    const original = document.querySelector("#captured");
    if (!original) throw new Error("Missing original root.");

    captureAriaSnapshot.mockReturnValueOnce({
      distilledText:
        '- generic [ref=e1]:\n  - button "Captured omitted" [ref=e2]',
      fullText: '- generic [ref=e1]:\n  - button "Captured omitted" [ref=e2]',
      refsByElement: new Map([
        [document.body, "e1"],
        [original, "e2"],
      ]),
    });
    listRegisteredPomRoots.mockResolvedValue([]);

    const firstText = await getPageStateTool.execute();
    expect(firstText).toContain('e2 button "Captured omitted"');

    original.outerHTML = '<button id="captured">Captured omitted</button>';
    const replacement = document.querySelector("#captured");
    if (!replacement) throw new Error("Missing replacement root.");

    captureAriaSnapshot.mockReturnValue({
      distilledText:
        '- generic [ref=e3]:\n  - button "Captured omitted" [ref=e4]',
      fullText: '- generic [ref=e3]:\n  - button "Captured omitted" [ref=e4]',
      refsByElement: new Map([
        [document.body, "e3"],
        [replacement, "e4"],
      ]),
    });

    const state = await ayme.getPageState();
    await expect(state.resolve(ref("e2"))).resolves.toEqual([
      {
        status: "resolved",
        requestedRef: ref("e2"),
        node: { ref: ref("e4"), element: replacement },
      },
    ]);
  });
  it("drops ignored elements even when they contain a present Page Object Root", async () => {
    document.body.innerHTML = `
      <div id="assistant">
        <div id="panel"><button id="panel-action">Panel action</button></div>
      </div>
      <button id="main">Main action</button>
    `;
    const assistant = document.querySelector("#assistant");
    const panel = document.querySelector("#panel");
    const panelAction = document.querySelector("#panel-action");
    const main = document.querySelector("#main");
    if (!assistant || !panel || !panelAction || !main)
      throw new Error("Missing test roots.");

    configurePageStateIgnore((element) => element.id === "assistant");
    captureAriaSnapshot.mockReturnValue({
      distilledText: `
- generic [ref=e1]:
  - button "Panel action" [ref=e2]
  - button "Main action" [ref=e3]
`.trim(),
      fullText: `
- generic [ref=e1]:
  - generic [ref=e4]:
    - generic [ref=e5]:
      - button "Panel action" [ref=e2]
  - button "Main action" [ref=e3]
`.trim(),
      refsByElement: new Map([
        [document.body, "e1"],
        [assistant, "e4"],
        [panel, "e5"],
        [panelAction, "e2"],
        [main, "e3"],
      ]),
    });
    listRegisteredPomRoots.mockResolvedValue([
      { label: "Panel.root", element: panel },
    ]);

    await expect(getPageStateTool.execute()).resolves.toMatchInlineSnapshot(`
      "- e1:
        - e3 button "Main action""
    `);
  });

  it("excludes the inspector host through the built-in ignore predicate", async () => {
    document.body.innerHTML = `
      <main><h1 id="app">Consumer application</h1></main>
      <div data-ayme-inspector-host><span id="inspector">POM inspector controls</span></div>
    `;
    const app = document.querySelector("#app");
    const host = document.querySelector("[data-ayme-inspector-host]");
    const inspector = document.querySelector("#inspector");
    if (!app || !host || !inspector) throw new Error("Missing test roots.");

    captureAriaSnapshot.mockReturnValue({
      distilledText: `
- generic [ref=e1]:
  - heading "Consumer application" [ref=e2]
  - generic "POM inspector controls" [ref=e3]
`.trim(),
      fullText: `
- generic [ref=e1]:
  - main [ref=e4]:
    - heading "Consumer application" [ref=e2]
  - generic [ref=e5]:
    - generic "POM inspector controls" [ref=e3]
`.trim(),
      refsByElement: new Map([
        [document.body, "e1"],
        [app, "e2"],
        [host, "e5"],
        [inspector, "e3"],
      ]),
    });
    listRegisteredPomRoots.mockResolvedValue([]);

    await expect(getPageStateTool.execute()).resolves.toMatchInlineSnapshot(`
      "- e1:
        - e2 heading "Consumer application""
    `);
    expect(captureAriaSnapshot).toHaveBeenCalledWith(document.body);
  });

  it("exposes typed capture data through the package-internal interface", async () => {
    const original = document.querySelector("#captured");
    if (!original) throw new Error("Missing test root.");

    captureAriaSnapshot.mockReturnValueOnce({
      distilledText:
        '- generic [ref=e1]:\n  - button "Captured omitted" [ref=e2]',
      fullText: '- generic [ref=e1]:\n  - button "Captured omitted" [ref=e2]',
      refsByElement: new Map([
        [document.body, "e1"],
        [original, "e2"],
      ]),
    });
    listRegisteredPomRoots.mockResolvedValue([]);

    const first = await getPageStateCaptureForDocument(document);
    expect(first.reconcile).toBeNull();
    expect(first.tree.getNode(ref("e2"))?.role).toBe("button");
    expect(first.tree.getNode(ref("e2"))?.name).toBe("Captured omitted");
    expect(first.elementsByRef.get(ref("e2"))).toBe(original);

    original.outerHTML = '<button id="captured">Captured omitted</button>';
    const replacement = document.querySelector("#captured");
    if (!replacement) throw new Error("Missing replacement root.");

    captureAriaSnapshot.mockReturnValue({
      distilledText:
        '- generic [ref=e3]:\n  - button "Captured omitted" [ref=e4]',
      fullText: '- generic [ref=e3]:\n  - button "Captured omitted" [ref=e4]',
      refsByElement: new Map([
        [document.body, "e3"],
        [replacement, "e4"],
      ]),
    });

    const second = await getPageStateCaptureForDocument(document);
    expect(second.reconcile).not.toBeNull();
    expect(second.tree.getNode(ref("e4"))?.name).toBe("Captured omitted");
    expect(second.elementsByRef.get(ref("e4"))).toBe(replacement);
    expect(second.reconcile?.getNode(ref("e4"))?.status?.kind).toBe("updated");
  });

  it("keeps concurrent capture results scoped to their own capture", async () => {
    const captured = document.querySelector("#captured");
    if (!captured) throw new Error("Missing test root.");

    captureAriaSnapshot
      .mockReturnValueOnce({
        distilledText:
          '- generic [ref=e1]:\n  - button "First capture" [ref=e2]',
        fullText: '- generic [ref=e1]:\n  - button "First capture" [ref=e2]',
        refsByElement: new Map([
          [document.body, "e1"],
          [captured, "e2"],
        ]),
      })
      .mockReturnValueOnce({
        distilledText:
          '- generic [ref=e3]:\n  - button "Second capture" [ref=e4]',
        fullText: '- generic [ref=e3]:\n  - button "Second capture" [ref=e4]',
        refsByElement: new Map([
          [document.body, "e3"],
          [captured, "e4"],
        ]),
      });
    listRegisteredPomRoots.mockResolvedValue([]);

    const [first, second] = await Promise.all([
      getPageStateCaptureForDocument(document),
      getPageStateCaptureForDocument(document),
    ]);

    expect(first.tree.getNode(ref("e2"))?.name).toBe("First capture");
    expect(second.tree.getNode(ref("e4"))?.name).toBe("Second capture");
  });
});
