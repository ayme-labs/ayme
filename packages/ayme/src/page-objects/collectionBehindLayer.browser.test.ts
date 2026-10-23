import { afterEach, describe, expect, it, vi } from "vitest";

import { createPage } from "./browserPage";
import { rooted } from "../test-utils/pomRoot.testSupport";
import {
  listRegisteredPomTools,
  probeRegisteredPomMembers,
  registerCompiledPom,
} from "./registry";
import type { PomManifest } from "../shared";
import { runContext } from "../test-utils/agentCalls.testSupport";
import { errorText } from "../shared";
import { getPageStateForDocument } from "../page-state";
import { startSession } from "../test-utils/session.testSupport";

// A modal menu as Radix opens one: the rest of the page is hidden from
// assistive technology and takes no pointer events, while the menu, a
// sibling of the page's content, still does.
const ROWS_UNDER_A_MODAL_MENU = `
  <style>body { margin: 0 }</style>
  <div id="app">
    <ul id="list" style="margin: 0">
      <li id="row-0" style="height: 60px">Row 0</li>
      <li style="height: 3000px"></li>
      <li id="row-1" style="height: 60px">Row 1</li>
      <li id="row-2" style="height: 60px">Row 2</li>
    </ul>
  </div>
  <div id="menu" role="menu" style="position: fixed; top: 0; right: 0; pointer-events: auto">
    <div role="menuitem">Duplicate</div>
  </div>
`;

function openModalMenu() {
  document.body.style.pointerEvents = "none";
  document.querySelector("#app")!.setAttribute("aria-hidden", "true");
}

const manifest: PomManifest = {
  className: "ListPage",
  tools: [],
  members: [
    {
      memberName: "rows",
      kind: "component",
      access: "field",
      componentClassName: "Row",
      collection: true,
    },
  ],
  components: [
    {
      className: "Row",
      members: [{ memberName: "root", kind: "locator", access: "field" }],
      tools: [
        {
          methodName: "open",
          toolName: "Row.open",
          description: "Open this row.",
          parameters: [],
          returnPoms: [],
        },
      ],
    },
  ],
};

function refOf(text: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const ref = text.match(
    new RegExp(`(?:^|\\s)((?:e|s_)\\w+) ${escaped}(?:\\b|:)`, "m")
  )?.[1];
  if (!ref) throw new Error(`No ref found for "${label}" in page state.`);
  return ref;
}

describe("a collection whose items are all behind a modal layer", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    document.body.removeAttribute("style");
    window.scrollTo(0, 0);
  });

  async function setUp() {
    document.body.innerHTML = ROWS_UNDER_A_MODAL_MENU;
    const page = createPage();
    const session = startSession(page);
    const opened = [vi.fn(), vi.fn(), vi.fn()];
    class ListPage {
      readonly rows = [0, 1, 2].map((i) =>
        rooted(page.locator(`#row-${i}`), { open: opened[i]! })
      );
    }
    registerCompiledPom(ListPage, manifest);
    session.register(ListPage);
    await probeRegisteredPomMembers();
    // The refs are read before the layer opens, as an agent read them.
    const { text } = await getPageStateForDocument(document);
    const refs = [0, 1, 2].map((i) => refOf(text, `ListPage.rows[${i}]`));
    openModalMenu();
    return { session, opened, refs };
  }

  async function listedOpen() {
    await probeRegisteredPomMembers();
    const listed = listRegisteredPomTools().find(
      ({ tool }) => tool.name === "ListPage.rows.open"
    );
    if (!listed) throw new Error("Expected ListPage.rows.open.");
    return listed;
  }

  it("lists the collection's tool unavailable, with items below the fold, at every observation", async () => {
    const { session } = await setUp();
    try {
      for (let observation = 0; observation < 3; observation++) {
        const { available, reason } = await listedOpen();
        expect({ available, reason }).toEqual({
          available: false,
          reason: "a click would not reach it",
        });
      }
      expect(window.scrollY).toBe(0);
    } finally {
      session.stop();
    }
  });

  it("refuses a call on an item below the fold without scrolling, naming the tool called", async () => {
    const { session, opened, refs } = await setUp();
    try {
      const { tool } = await listedOpen();
      const error = await tool
        .execute({ ref: refs[2], args: {} }, runContext())
        .then(() => "no error", errorText);

      // In the way is the page's content the layer hid, as for an inert one.
      expect(error).toMatch(
        /^RuntimeStateError: ListPage\.rows\.open is unavailable: a click would not reach it; e\d+ is in the way\.$/
      );
      expect(window.scrollY).toBe(0);
      expect(opened[2]).not.toHaveBeenCalled();
    } finally {
      session.stop();
    }
  });

  it("keeps an item below the fold available when no layer is open", async () => {
    document.body.innerHTML = ROWS_UNDER_A_MODAL_MENU;
    const page = createPage();
    const session = startSession(page);
    try {
      class ListPage {
        readonly rows = [0, 1, 2].map((i) =>
          rooted(page.locator(`#row-${i}`), { open: () => {} })
        );
      }
      registerCompiledPom(ListPage, manifest);
      session.register(ListPage);
      document.querySelector("#row-0")!.remove();
      expect((await listedOpen()).available).toBe(true);
    } finally {
      session.stop();
    }
  });
});
