import { afterEach, describe, expect, it, vi } from "vitest";

import { createPage } from "./browserPage";
import { rooted } from "../../test-utils/pomRoot.testSupport";
import {
  listRegisteredPomTools,
  probeRegisteredPomMembers,
  registerCompiledPom,
} from "./registry";
import type { PomManifest } from "../../shared";
import { runContext } from "../../test-utils/agentCalls.testSupport";
import { errorText } from "../../shared";
import { getPageStateForDocument } from "../../page-state";
import { startSession } from "../../test-utils/session.testSupport";

// A modal menu as Radix opens one: the rest of the page is hidden from
// assistive technology and takes no pointer events, while the menu, a
// sibling of the page's content, still does. Rows 1 and 2 are scrolled out
// of the list's view.
const ROWS_UNDER_A_MODAL_MENU = `
  <style>body { margin: 0 }</style>
  <div id="app">
    <ul id="list" style="margin: 0; height: 200px; overflow: auto">
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

const scrolled = () => ({
  page: window.scrollY,
  list: document.querySelector("#list")!.scrollTop,
});

describe("a collection whose items are all behind a modal layer", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    document.body.removeAttribute("style");
    window.scrollTo(0, 0);
  });

  /** The list registered and observed, with the menu not yet open. */
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
    const { text } = await getPageStateForDocument(document);
    const refs = [0, 1, 2].map((i) => refOf(text, `ListPage.rows[${i}]`));
    return { session, opened, refs };
  }

  /** The collection's tool as the last observation listed it. */
  function listedOpen() {
    const listed = listRegisteredPomTools().find(
      ({ tool }) => tool.name === "ListPage.rows.open"
    );
    if (!listed) throw new Error("Expected ListPage.rows.open.");
    return listed;
  }

  async function observedOpen() {
    await probeRegisteredPomMembers();
    return listedOpen();
  }

  it("lists the collection's tool unavailable, with items out of view, at every observation", async () => {
    const { session } = await setUp();
    try {
      openModalMenu();
      for (let observation = 0; observation < 3; observation++) {
        const { available, reason } = await observedOpen();
        expect({ available, reason }).toEqual({
          available: false,
          reason: "a click would not reach it",
        });
      }
      expect(scrolled()).toEqual({ page: 0, list: 0 });
    } finally {
      session.stop();
    }
  });

  // The menu opens after the observation that listed the tool, so the call
  // itself finds it.
  it("refuses a call on an item out of view without scrolling, naming the tool called", async () => {
    const { session, opened, refs } = await setUp();
    try {
      const { tool, available } = listedOpen();
      expect(available).toBe(true);
      openModalMenu();
      const error = await tool
        .execute({ ref: refs[2], args: {} }, runContext())
        .then(() => "no error", errorText);

      // In the way is the page's content the layer hid, as for an inert one.
      expect(error).toMatch(
        /^RuntimeStateError: ListPage\.rows\.open is unavailable: a click would not reach it; e\d+ is in the way\.$/
      );
      expect(scrolled()).toEqual({ page: 0, list: 0 });
      expect(opened[2]).not.toHaveBeenCalled();
    } finally {
      session.stop();
    }
  });

  it("refuses a call on an item in view, naming the tool called", async () => {
    const { session, opened, refs } = await setUp();
    try {
      const { tool } = listedOpen();
      openModalMenu();
      const error = await tool
        .execute({ ref: refs[0], args: {} }, runContext())
        .then(() => "no error", errorText);

      expect(error).toMatch(
        /^RuntimeStateError: ListPage\.rows\.open is unavailable: a click would not reach it(; e\d+ is in the way)?\.$/
      );
      expect(opened[0]).not.toHaveBeenCalled();
    } finally {
      session.stop();
    }
  });

  // Without a layer an item out of view is listed available and tested once
  // the call has scrolled to it (ADR-0041); a cover over the list's view then
  // refuses it there.
  it("refuses a call on an item covered where its scroll lands, naming the tool called", async () => {
    const { session, opened, refs } = await setUp();
    try {
      document.body.insertAdjacentHTML(
        "beforeend",
        '<div style="position: fixed; inset: 0 0 auto 0; height: 200px"></div>'
      );
      const { tool, available } = await observedOpen();
      expect(available).toBe(true);
      const error = await tool
        .execute({ ref: refs[2], args: {} }, runContext())
        .then(() => "no error", errorText);

      expect(error).toBe(
        "RuntimeStateError: ListPage.rows.open is unavailable: a click would not reach it."
      );
      expect(scrolled().list).toBeGreaterThan(0);
      expect(opened[2]).not.toHaveBeenCalled();
    } finally {
      session.stop();
    }
  });

  it("keeps an item out of view available when part of it takes pointer events again", async () => {
    const { session } = await setUp();
    try {
      document.querySelector("#row-2")!.innerHTML =
        '<span style="pointer-events: auto">Row 2</span>';
      openModalMenu();
      expect((await observedOpen()).available).toBe(true);
    } finally {
      session.stop();
    }
  });

  it("keeps an item out of view available when no layer is open", async () => {
    const { session } = await setUp();
    try {
      document.querySelector("#row-0")!.remove();
      expect((await observedOpen()).available).toBe(true);
    } finally {
      session.stop();
    }
  });
});
