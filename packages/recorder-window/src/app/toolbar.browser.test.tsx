import type {
  RecorderCommand,
  RecorderState,
  RecorderUpdate,
  ToolbarMessage,
} from "@ayme-dev/recorder/contract";
import { createPage, selectors } from "@ayme-dev/playwright-lite";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
// The Playwright provider takes Playwright's own click options.
import type {} from "@vitest/browser-playwright";

import { RecorderToolbar } from "../testing";
import {
  bindingIn,
  mountToolbar,
  TOOLBAR_HOST,
  TOOLBAR_REMOVE,
  type ToolbarCall,
} from "./toolbarMount";

// Component tests: the toolbar, mounted as its script mounts it in a
// recorded page, talking to a page function the test plays, and read and
// pressed through its page objects on playwright-lite. A person's own input
// is given through Vitest's Playwright provider, as trusted input at a
// point of the page: the toolbar stops only that at the window.

const page = createPage();
let toolbar: RecorderToolbar;
const removals: (() => void)[] = [];

beforeAll(async () => {
  toolbar = await RecorderToolbar.on(page, selectors);
});

afterEach(() => {
  for (const remove of removals.splice(0)) remove();
  vi.restoreAllMocks();
});

/** The page function the engine puts in a recorded page, played by the
 * test: it tells states, and keeps what is sent. */
function scriptedPage() {
  const sent: RecorderCommand[] = [];
  let latest: RecorderUpdate | undefined;
  let revision = 0;
  const waiting = new Set<() => void>();
  const asked = { updates: 0 };
  const call: ToolbarCall = async (message: ToolbarMessage) => {
    if (message.kind === "send") {
      sent.push(message.command);
      return "applied";
    }
    asked.updates += 1;
    // The toolbar pulls the first update above the newest it heard.
    for (;;) {
      if (latest && latest.revision > message.after) return latest;
      await new Promise<void>((resolve) => waiting.add(resolve));
    }
  };
  return {
    call,
    sent,
    asked,
    tell(state: Partial<RecorderState>) {
      latest = {
        revision: ++revision,
        state: { visits: [], commands: [], warnings: [], ...state },
      } as unknown as RecorderUpdate;
      for (const wake of [...waiting]) {
        waiting.delete(wake);
        wake();
      }
    },
  };
}

function mount(call: ToolbarCall) {
  const host = mountToolbar(call);
  removals.push(() => host.dispatchEvent(new Event(TOOLBAR_REMOVE)));
  return host;
}

/** A person's click at the middle of a toolbar button, given as trusted
 * input at that point of the page. */
async function personClicks(host: HTMLElement, name: string) {
  const box = (await toolbar.button(name as "Record").boundingBox())!;
  await userEvent.click(host, {
    position: { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    // The host lets pointer events through to the page: the point is the
    // toolbar's.
    force: true,
  });
}

describe("the toolbar", () => {
  it("shows the recorder's state and the controls that apply, and sends what is pressed", async () => {
    const { call, sent, tell } = scriptedPage();
    mount(call);

    tell({ phase: "notRecording", commands: ["record"] });

    await expect.poll(() => toolbar.status.textContent()).toBe("Not recording");
    expect(await toolbar.offered()).toEqual(["Record"]);
    await toolbar.button("Record").click();
    expect(sent).toEqual([{ type: "record" }]);
  });

  it("offers Stop, Clear and Finish while recording, and shows Assert visibility on while Playwright picks", async () => {
    const { call, sent, tell } = scriptedPage();
    mount(call);

    tell({
      phase: "recording",
      picking: true,
      commands: ["stop", "clear", "finish", "leaveAssertVisibility"],
    } as Partial<RecorderState>);

    await expect.poll(() => toolbar.picking()).toBe(true);
    expect(await toolbar.offered()).toEqual(["Stop", "Clear", "Finish"]);
    await toolbar.assertVisibility.click();
    await toolbar.button("Clear").click();
    await toolbar.button("Finish").click();
    expect(sent).toEqual([
      { type: "leaveAssertVisibility" },
      { type: "clear" },
      { type: "finish" },
    ]);
  });

  it("shows Assert visibility filled as Finish is while Playwright picks", async () => {
    const { call, tell } = scriptedPage();
    mount(call);
    tell({
      phase: "recording",
      picking: true,
      commands: ["stop", "finish", "leaveAssertVisibility"],
    } as Partial<RecorderState>);
    await expect.poll(() => toolbar.picking()).toBe(true);
    const fill = (control: typeof toolbar.root) =>
      control.evaluate((element) => getComputedStyle(element).backgroundColor);

    expect(await fill(toolbar.assertVisibility)).toBe(
      await fill(toolbar.button("Finish"))
    );
  });

  it("sits at the bottom right of the page, apart from the page's structure, layout and styles", async () => {
    const style = document.createElement("style");
    style.textContent = `${TOOLBAR_HOST} { opacity: 0.5 !important; position: static !important; }`;
    document.head.append(style);
    removals.push(() => style.remove());
    const { call, tell } = scriptedPage();
    const host = mount(call);
    tell({ phase: "notRecording", commands: ["record"] });
    await expect.poll(() => toolbar.offered()).toEqual(["Record"]);

    const shown = getComputedStyle(host);
    expect(host.getAttribute("aria-hidden")).toBe("true");
    expect([
      shown.position,
      shown.top,
      shown.left,
      shown.pointerEvents,
      shown.zIndex,
      shown.opacity,
    ]).toEqual(["fixed", "0px", "0px", "none", "2147483647", "1"]);
    expect(shown.contain).toMatch(/strict|size layout paint style/);
    const box = (await toolbar.root.boundingBox())!;
    expect(innerWidth - (box.x + box.width)).toBe(12);
    expect(innerHeight - (box.y + box.height)).toBe(12);
  });

  it("shows itself in the dark scheme when the person's system asks for it", async () => {
    vi.spyOn(globalThis, "matchMedia").mockImplementation(
      (query) =>
        ({
          matches: query === "(prefers-color-scheme: dark)",
        }) as MediaQueryList
    );
    const { call, tell } = scriptedPage();
    mount(call);
    tell({ phase: "notRecording", commands: ["record"] });

    await expect.poll(() => toolbar.offered()).toEqual(["Record"]);
    expect(
      await toolbar.root.evaluate((root) => root.closest(".dark") !== null)
    ).toBe(true);
  });

  it("shows itself in the light scheme otherwise", async () => {
    vi.spyOn(globalThis, "matchMedia").mockImplementation(
      (query) =>
        ({
          // It answers any other question yes: only the scheme is asked.
          matches: query !== "(prefers-color-scheme: dark)",
        }) as MediaQueryList
    );
    const { call, tell } = scriptedPage();
    mount(call);
    tell({ phase: "notRecording", commands: ["record"] });

    await expect.poll(() => toolbar.offered()).toEqual(["Record"]);
    expect(
      await toolbar.root.evaluate((root) => root.closest(".dark") !== null)
    ).toBe(false);
  });

  it("comes back when the page takes it out of its document", async () => {
    const { call, tell } = scriptedPage();
    const host = mount(call);
    tell({ phase: "notRecording", commands: ["record"] });
    await expect.poll(() => toolbar.offered()).toEqual(["Record"]);

    host.remove();
    await expect.poll(() => host.isConnected).toBe(true);
    host.remove();

    await expect.poll(() => host.isConnected).toBe(true);
    expect(await toolbar.offered()).toEqual(["Record"]);
  });

  it("keeps the page's own elements where the page puts them", async () => {
    const { call, tell } = scriptedPage();
    const host = mount(call);
    tell({ phase: "notRecording", commands: ["record"] });
    await expect.poll(() => toolbar.offered()).toEqual(["Record"]);
    const own = document.createElement("div");

    document.documentElement.append(own);
    removals.push(() => own.remove());
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(document.documentElement.lastElementChild).toBe(own);
    expect(host.nextElementSibling).toBe(own);
  });

  it("asks the recorder nothing more once the engine has let go of it", async () => {
    const { call, asked, tell } = scriptedPage();
    const host = mountToolbar(call);
    tell({ phase: "notRecording", commands: ["record"] });
    await expect.poll(() => toolbar.offered()).toEqual(["Record"]);
    // It waits for the next update, as it does all the time.
    await expect.poll(() => asked.updates).toBe(2);

    host.dispatchEvent(new Event(TOOLBAR_REMOVE));
    tell({ phase: "recording", commands: ["stop"] });
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(asked.updates).toBe(2);
  });

  it("leaves the page when the engine lets go of it", async () => {
    const { call, tell } = scriptedPage();
    const host = mountToolbar(call);
    tell({ phase: "notRecording", commands: ["record"] });
    await expect.poll(() => toolbar.offered()).toEqual(["Record"]);

    host.dispatchEvent(new Event(TOOLBAR_REMOVE));
    document.documentElement.append(document.createElement("div"));

    await expect.poll(() => toolbar.root.count()).toBe(0);
    expect(host.isConnected).toBe(false);
  });
});

describe("a person's input on the toolbar", () => {
  /** Every error the page sees thrown while the test runs. */
  function pageErrors() {
    const errors: string[] = [];
    const listener = (event: ErrorEvent) => errors.push(event.message);
    addEventListener("error", listener);
    removals.push(() => removeEventListener("error", listener));
    return errors;
  }

  it("presses nothing, and raises no error in the page, off the toolbar's buttons", async () => {
    const { call, sent, tell } = scriptedPage();
    const host = mount(call);
    tell({ phase: "notRecording", commands: ["record"] });
    await expect.poll(() => toolbar.offered()).toEqual(["Record"]);
    const box = (await toolbar.status.boundingBox())!;
    const errors = pageErrors();

    await userEvent.click(host, {
      position: { x: box.x + box.width / 2, y: box.y + box.height / 2 },
      force: true,
    });

    expect(sent).toEqual([]);
    expect(errors).toEqual([]);
  });

  /** Every input of the person's own the page hears, on its document. A
   * click the toolbar gives its own button is untrusted: the page's
   * listeners and Playwright's recorder take it for no person's. */
  function pageListens() {
    const heard: string[] = [];
    const types = [
      "pointerdown",
      "pointerup",
      "mousedown",
      "mouseup",
      "click",
      "auxclick",
      "dblclick",
      "contextmenu",
    ];
    const listener = (event: Event) => {
      if (event.isTrusted) heard.push(event.type);
    };
    for (const type of types) document.addEventListener(type, listener, true);
    removals.push(() => {
      for (const type of types)
        document.removeEventListener(type, listener, true);
    });
    return heard;
  }

  it("presses the button under it, and reaches neither the page nor its focus", async () => {
    const { call, sent, tell } = scriptedPage();
    const host = mount(call);
    tell({ phase: "recording", commands: ["stop", "clear", "finish"] });
    await expect
      .poll(() => toolbar.offered())
      .toEqual(["Stop", "Clear", "Finish"]);
    const field = document.createElement("input");
    document.body.append(field);
    removals.push(() => field.remove());
    field.focus();
    const heard = pageListens();
    const errors = pageErrors();

    await personClicks(host, "Finish");

    expect(sent).toEqual([{ type: "finish" }]);
    expect(heard).toEqual([]);
    expect(errors).toEqual([]);
    expect(document.activeElement).toBe(field);
  });

  it("presses nothing that cannot be pressed now", async () => {
    const { call, sent, tell } = scriptedPage();
    const host = mount(call);
    tell({ phase: "notRecording", commands: ["record"] });
    await expect.poll(() => toolbar.offered()).toEqual(["Record"]);
    const heard = pageListens();

    await personClicks(host, "Finish");

    expect(sent).toEqual([]);
    expect(heard).toEqual([]);
  });

  /** The middle of the Record button, with the toolbar showing it. */
  async function recordButton() {
    const { call, tell } = scriptedPage();
    const host = mount(call);
    tell({ phase: "notRecording", commands: ["record"] });
    await expect.poll(() => toolbar.offered()).toEqual(["Record"]);
    const box = (await toolbar.button("Record").boundingBox())!;
    return {
      host,
      at: { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    };
  }

  it("stops a double click at the window as well", async () => {
    const { host, at } = await recordButton();
    const heard = pageListens();

    await userEvent.dblClick(host, { position: at, force: true });

    expect(heard).toEqual([]);
  });

  it("stops a right click at the window as well", async () => {
    const { host, at } = await recordButton();
    const heard = pageListens();

    await userEvent.click(host, { button: "right", position: at, force: true });

    expect(heard).toEqual([]);
  });

  it("leaves the page's own input alone", async () => {
    const { call, sent, tell } = scriptedPage();
    mount(call);
    tell({ phase: "notRecording", commands: ["record"] });
    await expect.poll(() => toolbar.offered()).toEqual(["Record"]);
    const button = document.createElement("button");
    button.textContent = "The page's own";
    document.body.prepend(button);
    removals.push(() => button.remove());
    const heard = pageListens();

    await userEvent.click(button);

    expect(heard).toEqual([
      "pointerdown",
      "mousedown",
      "pointerup",
      "mouseup",
      "click",
    ]);
    expect(sent).toEqual([]);
  });
});

describe("where the toolbar is put", () => {
  const call: ToolbarCall = async () => null;
  const binding = "__aymeRecorderToolbar";
  const emptyDocument = { querySelector: () => null };

  it("in a top document, with the engine's page function beside it", () => {
    const top = { top: null as unknown, [binding]: call };
    top.top = top;

    expect(bindingIn(top, emptyDocument)).toBe(call);
  });

  it("in no frame, no document that shows one already, and none where the engine put no function", () => {
    const frame = { top: {}, [binding]: call };
    const top = { top: null as unknown, [binding]: call };
    top.top = top;
    const bare = { top: null as unknown, [binding]: "not a function" };
    bare.top = bare;
    const shown = {
      querySelector: (selector: string) =>
        selector === TOOLBAR_HOST ? document.createElement("div") : null,
    };

    expect(bindingIn(frame, emptyDocument)).toBeUndefined();
    expect(bindingIn(top, shown)).toBeUndefined();
    expect(bindingIn(bare, emptyDocument)).toBeUndefined();
  });
});
