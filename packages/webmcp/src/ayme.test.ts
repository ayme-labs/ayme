// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { captureAriaSnapshot, listRegisteredPomRoots, listRegisteredPoms } =
  vi.hoisted(() => ({
    captureAriaSnapshot: vi.fn(),
    listRegisteredPomRoots: vi.fn(),
    listRegisteredPoms: vi.fn(),
  }));

vi.mock("@ayme-dev/playwright-lite/internal", () => ({ captureAriaSnapshot }));
vi.mock("./registry", () => ({
  getRegisteredPomStructure: async () => ({
    roots: await listRegisteredPomRoots(),
    absentElements: [],
  }),
  listRegisteredPoms,
}));

import ayme, { ayme as namedAyme } from "./index";
import { AriaRefSchema } from "@ayme-dev/core/structural-observation";

const ref = AriaRefSchema.parse;

describe("the public Ayme page state facade", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "document",
      document.implementation.createHTMLDocument("Ayme test")
    );
    document.body.innerHTML = '<button id="save">Save changes</button>';
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exports the facade by name as well as by default", () => {
    expect(namedAyme).toBe(ayme);
  });

  it("combines page state with named POM definitions", async () => {
    const button = document.querySelector("#save");
    if (!button) throw new Error("Expected the save button.");
    captureAriaSnapshot.mockReturnValue({
      distilledText: '- button "Save changes" [ref=e1]',
      fullText: '- button "Save changes" [ref=e1]',
      refsByElement: new Map([[button, "e1"]]),
    });
    listRegisteredPomRoots.mockResolvedValue([]);
    listRegisteredPoms.mockReturnValue([
      {
        manifest: {
          className: "ProfileMenu",
          members: [],
          components: [],
          tools: [],
        },
      },
    ]);

    const context = await ayme.getPageContext("ProfileMenu");

    expect(context.structure).toBe('- e1 button "Save changes"');
    expect(context.pomDefinitions).toEqual([
      {
        name: "ProfileMenu",
        children: [],
        actions: [],
      },
    ]);
    expect(ayme.getPomDefinitions("ProfileMenu")).toEqual({
      definitions: context.pomDefinitions,
    });
  });

  it("captures rendered state and resolves each current requested ref in order", async () => {
    const button = document.querySelector("#save");
    if (!button) throw new Error("Expected the save button.");

    captureAriaSnapshot.mockReturnValue({
      distilledText: `
- generic [ref=e1]:
  - button "Save changes" [ref=e2]
`.trim(),
      fullText: `
- generic [ref=e1]:
  - button "Save changes" [ref=e2]
`.trim(),
      refsByElement: new Map([
        [document.body, "e1"],
        [button, "e2"],
      ]),
    });
    listRegisteredPomRoots.mockResolvedValue([]);

    const state = await ayme.getPageState();

    expect(state.text).toBe(
      `
- e1:
  - e2 button "Save changes"
`.trim()
    );
    await expect(
      state.resolve(
        AriaRefSchema.parse("e2"),
        AriaRefSchema.parse("missing"),
        AriaRefSchema.parse("e1")
      )
    ).resolves.toEqual([
      {
        status: "resolved",
        requestedRef: AriaRefSchema.parse("e2"),
        node: { ref: AriaRefSchema.parse("e2"), element: button },
      },
      {
        status: "unresolved",
        requestedRef: AriaRefSchema.parse("missing"),
        reason: "unknown-ref",
      },
      {
        status: "resolved",
        requestedRef: AriaRefSchema.parse("e1"),
        node: { ref: AriaRefSchema.parse("e1"), element: document.body },
      },
    ]);
  });

  it("resolves a composed synthetic POM root to its originating element", async () => {
    document.body.innerHTML = `
      <div id="account"><button id="save">Save changes</button></div>
    `;
    const account = document.querySelector("#account");
    const button = document.querySelector("#save");
    if (!account || !button) throw new Error("Expected the account markup.");

    captureAriaSnapshot.mockReturnValue({
      distilledText: `
- generic [ref=e1]:
  - button "Save changes" [ref=e2]
`.trim(),
      fullText: `
- generic [ref=e1]:
  - generic:
    - button "Save changes" [ref=e2]
`.trim(),
      refsByElement: new Map([
        [document.body, "e1"],
        [button, "e2"],
      ]),
    });
    listRegisteredPomRoots.mockResolvedValue([
      { label: "AccountPage.root", element: account },
    ]);

    const state = await ayme.getPageState();

    expect(state.text).toContain("s_1 AccountPage.root");
    await expect(state.resolve(AriaRefSchema.parse("s_1"))).resolves.toEqual([
      {
        status: "resolved",
        requestedRef: AriaRefSchema.parse("s_1"),
        node: { ref: AriaRefSchema.parse("s_2"), element: account },
      },
    ]);
  });

  it("retargets reordered synthetic roots and does not rebind a removed root", async () => {
    document.body.innerHTML = `
      <section id="account"><button id="account-button">Account</button></section>
      <section id="billing"><button id="billing-button">Billing</button></section>
    `;
    const account = document.querySelector("#account");
    const accountButton = document.querySelector("#account-button");
    const billing = document.querySelector("#billing");
    const billingButton = document.querySelector("#billing-button");
    if (!account || !accountButton || !billing || !billingButton)
      throw new Error("Expected both POM roots.");

    captureAriaSnapshot
      .mockReturnValueOnce({
        distilledText:
          '- generic [ref=e1]:\n  - button "Account" [ref=e2]\n  - button "Billing" [ref=e3]',
        fullText:
          '- generic [ref=e1]:\n  - generic:\n    - button "Account" [ref=e2]\n  - generic:\n    - button "Billing" [ref=e3]',
        refsByElement: new Map([
          [document.body, "e1"],
          [accountButton, "e2"],
          [billingButton, "e3"],
        ]),
      })
      .mockReturnValueOnce({
        distilledText:
          '- generic [ref=e1]:\n  - button "Billing" [ref=e3]\n  - button "Account" [ref=e2]',
        fullText:
          '- generic [ref=e1]:\n  - generic:\n    - button "Billing" [ref=e3]\n  - generic:\n    - button "Account" [ref=e2]',
        refsByElement: new Map([
          [document.body, "e1"],
          [billingButton, "e3"],
          [accountButton, "e2"],
        ]),
      })
      .mockReturnValueOnce({
        distilledText: '- generic [ref=e1]:\n  - button "Billing" [ref=e3]',
        fullText:
          '- generic [ref=e1]:\n  - generic:\n    - button "Billing" [ref=e3]',
        refsByElement: new Map([
          [document.body, "e1"],
          [billingButton, "e3"],
        ]),
      });
    listRegisteredPomRoots
      .mockResolvedValueOnce([
        { label: "Account.root", element: account },
        { label: "Billing.root", element: billing },
      ])
      .mockResolvedValueOnce([
        { label: "Account.root", element: account },
        { label: "Billing.root", element: billing },
      ])
      .mockResolvedValueOnce([{ label: "Billing.root", element: billing }]);

    const state = await ayme.getPageState();
    expect(state.text).toContain("s_1 Account.root");
    expect(state.text).toContain("s_2 Billing.root");
    document.body.prepend(billing);
    const reorderedState = await ayme.getPageState();
    expect(reorderedState.text).toContain("s_3 Account.root");
    expect(reorderedState.text).toContain("s_4 Billing.root");
    account.remove();

    await expect(
      state.resolve(ref("s_1"), ref("s_2"), ref("s_3"), ref("s_4"))
    ).resolves.toEqual([
      { status: "unresolved", requestedRef: ref("s_1"), reason: "removed" },
      {
        status: "resolved",
        requestedRef: ref("s_2"),
        node: { ref: ref("s_5"), element: billing },
      },
      { status: "unresolved", requestedRef: ref("s_3"), reason: "removed" },
      {
        status: "resolved",
        requestedRef: ref("s_4"),
        node: { ref: ref("s_5"), element: billing },
      },
    ]);
  });

  it("reports a rendered ref without an associated element as unresolved", async () => {
    captureAriaSnapshot.mockReturnValue({
      distilledText: "- generic [ref=e1]:",
      fullText: "- generic [ref=e1]:",
      refsByElement: new Map(),
    });
    listRegisteredPomRoots.mockResolvedValue([]);

    const state = await ayme.getPageState();

    await expect(state.resolve(AriaRefSchema.parse("e1"))).resolves.toEqual([
      {
        status: "unresolved",
        requestedRef: AriaRefSchema.parse("e1"),
        reason: "no-element",
      },
    ]);
  });

  it("retargets every observed alias and retained PageState to the latest node", async () => {
    const original = document.querySelector("#save");
    if (!original) throw new Error("Expected the original button.");
    captureAriaSnapshot.mockReturnValueOnce({
      distilledText: '- generic [ref=e1]:\n  - button "Save changes" [ref=e2]',
      fullText: '- generic [ref=e1]:\n  - button "Save changes" [ref=e2]',
      refsByElement: new Map([
        [document.body, "e1"],
        [original, "e2"],
      ]),
    });
    listRegisteredPomRoots.mockResolvedValue([]);
    const retainedState = await ayme.getPageState();

    original.outerHTML = '<button id="save">Save changes</button>';
    const intermediate = document.querySelector("#save");
    if (!intermediate) throw new Error("Expected the intermediate button.");
    captureAriaSnapshot.mockReturnValueOnce({
      distilledText: '- generic [ref=e3]:\n  - button "Save changes" [ref=e4]',
      fullText: '- generic [ref=e3]:\n  - button "Save changes" [ref=e4]',
      refsByElement: new Map([
        [document.body, "e3"],
        [intermediate, "e4"],
      ]),
    });
    await ayme.getPageState();

    intermediate.outerHTML = '<button id="save">Save changes</button>';
    const latest = document.querySelector("#save");
    if (!latest) throw new Error("Expected the latest button.");
    captureAriaSnapshot.mockReturnValueOnce({
      distilledText: '- generic [ref=e5]:\n  - button "Save changes" [ref=e6]',
      fullText: '- generic [ref=e5]:\n  - button "Save changes" [ref=e6]',
      refsByElement: new Map([
        [document.body, "e5"],
        [latest, "e6"],
      ]),
    });

    await expect(
      retainedState.resolve(
        AriaRefSchema.parse("e2"),
        AriaRefSchema.parse("e4"),
        AriaRefSchema.parse("e6")
      )
    ).resolves.toEqual(
      ["e2", "e4", "e6"].map((requestedRef) => ({
        status: "resolved",
        requestedRef: AriaRefSchema.parse(requestedRef),
        node: { ref: AriaRefSchema.parse("e6"), element: latest },
      }))
    );
  });

  it("establishes an identity for a node added during resolve", async () => {
    document.body.innerHTML = "";
    captureAriaSnapshot.mockReturnValueOnce({
      distilledText: "- generic [ref=e1]",
      fullText: "- generic [ref=e1]",
      refsByElement: new Map([[document.body, "e1"]]),
    });
    listRegisteredPomRoots.mockResolvedValue([]);
    const state = await ayme.getPageState();

    document.body.innerHTML = '<button id="added">Added</button>';
    const added = document.querySelector("#added");
    if (!added) throw new Error("Expected the added button.");
    captureAriaSnapshot.mockReturnValueOnce({
      distilledText: '- generic [ref=e1]:\n  - button "Added" [ref=e2]',
      fullText: '- generic [ref=e1]:\n  - button "Added" [ref=e2]',
      refsByElement: new Map([
        [document.body, "e1"],
        [added, "e2"],
      ]),
    });

    await expect(state.resolve(AriaRefSchema.parse("e2"))).resolves.toEqual([
      {
        status: "resolved",
        requestedRef: AriaRefSchema.parse("e2"),
        node: { ref: AriaRefSchema.parse("e2"), element: added },
      },
    ]);
  });

  it("reports a removed historical identity", async () => {
    const removed = document.querySelector("#save");
    if (!removed) throw new Error("Expected the removable button.");
    captureAriaSnapshot
      .mockReturnValueOnce({
        distilledText:
          '- generic [ref=e1]:\n  - button "Save changes" [ref=e2]',
        fullText: '- generic [ref=e1]:\n  - button "Save changes" [ref=e2]',
        refsByElement: new Map([
          [document.body, "e1"],
          [removed, "e2"],
        ]),
      })
      .mockReturnValueOnce({
        distilledText: "- generic [ref=e1]",
        fullText: "- generic [ref=e1]",
        refsByElement: new Map([[document.body, "e1"]]),
      });
    listRegisteredPomRoots.mockResolvedValue([]);
    const state = await ayme.getPageState();
    removed.remove();

    await expect(state.resolve(AriaRefSchema.parse("e2"))).resolves.toEqual([
      {
        status: "unresolved",
        requestedRef: AriaRefSchema.parse("e2"),
        reason: "removed",
      },
    ]);
  });

  it("reports a historical identity whose current candidates are ambiguous", async () => {
    const original = document.querySelector("#save");
    if (!original) throw new Error("Expected the original button.");
    captureAriaSnapshot.mockReturnValueOnce({
      distilledText: '- generic [ref=e1]:\n  - button "Save changes" [ref=e2]',
      fullText: '- generic [ref=e1]:\n  - button "Save changes" [ref=e2]',
      refsByElement: new Map([
        [document.body, "e1"],
        [original, "e2"],
      ]),
    });
    listRegisteredPomRoots.mockResolvedValue([]);
    const state = await ayme.getPageState();

    document.body.innerHTML = `
      <button id="first" disabled>Save changes</button>
      <button id="second" disabled>Save changes</button>
    `;
    const first = document.querySelector("#first");
    const second = document.querySelector("#second");
    if (!first || !second) throw new Error("Expected ambiguous candidates.");
    captureAriaSnapshot.mockReturnValueOnce({
      distilledText:
        '- generic [ref=e1]:\n  - button "Save changes" [disabled] [ref=e4]\n  - button "Save changes" [disabled] [ref=e5]',
      fullText:
        '- generic [ref=e1]:\n  - button "Save changes" [disabled] [ref=e4]\n  - button "Save changes" [disabled] [ref=e5]',
      refsByElement: new Map([
        [document.body, "e1"],
        [first, "e4"],
        [second, "e5"],
      ]),
    });

    await expect(state.resolve(AriaRefSchema.parse("e2"))).resolves.toEqual([
      {
        status: "unresolved",
        requestedRef: AriaRefSchema.parse("e2"),
        reason: "ambiguous",
      },
    ]);
  });

  it("does not carry aliases into a different Document", async () => {
    const firstButton = document.querySelector("#save");
    if (!firstButton) throw new Error("Expected the first document button.");
    captureAriaSnapshot.mockReturnValueOnce({
      distilledText: '- generic [ref=e1]:\n  - button "Save changes" [ref=e2]',
      fullText: '- generic [ref=e1]:\n  - button "Save changes" [ref=e2]',
      refsByElement: new Map([
        [document.body, "e1"],
        [firstButton, "e2"],
      ]),
    });
    listRegisteredPomRoots.mockResolvedValue([]);
    await ayme.getPageState();

    const replacementDocument =
      document.implementation.createHTMLDocument("Replacement");
    replacementDocument.body.innerHTML = '<button id="new">New page</button>';
    const replacementButton = replacementDocument.querySelector("#new");
    if (!replacementButton) throw new Error("Expected the replacement button.");
    vi.stubGlobal("document", replacementDocument);
    captureAriaSnapshot.mockReturnValue({
      distilledText: '- generic [ref=e8]:\n  - button "New page" [ref=e9]',
      fullText: '- generic [ref=e8]:\n  - button "New page" [ref=e9]',
      refsByElement: new Map([
        [replacementDocument.body, "e8"],
        [replacementButton, "e9"],
      ]),
    });

    const replacementState = await ayme.getPageState();
    await expect(
      replacementState.resolve(AriaRefSchema.parse("e2"))
    ).resolves.toEqual([
      {
        status: "unresolved",
        requestedRef: AriaRefSchema.parse("e2"),
        reason: "unknown-ref",
      },
    ]);
  });
});
