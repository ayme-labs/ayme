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

import { RecorderToolbar } from "../../testing";
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

type Locator = RecorderToolbar["root"];

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
        state: {
          visits: [],
          commands: [],
          warnings: [],
          url: null,
          ...state,
        },
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

/** A person's click at the middle of a toolbar control, given as trusted
 * input at that point of the page. */
async function personClicks(host: HTMLElement, control: Locator) {
  const box = (await control.boundingBox())!;
  await userEvent.click(host, {
    position: { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    // The host lets pointer events through to the page: the point is the
    // toolbar's.
    force: true,
  });
}

/** The system's colour scheme, played by the test: it can change while the
 * toolbar shows. */
function scheme(dark: boolean) {
  const listeners = new Set<() => void>();
  let matches = dark;
  vi.spyOn(globalThis, "matchMedia").mockImplementation(
    (query) =>
      ({
        get matches() {
          return query === "(prefers-color-scheme: dark)" && matches;
        },
        addEventListener: (_: string, listener: () => void) =>
          listeners.add(listener),
        removeEventListener: (_: string, listener: () => void) =>
          listeners.delete(listener),
      }) as unknown as MediaQueryList
  );
  return {
    set(next: boolean) {
      matches = next;
      for (const listener of listeners) listener();
    },
  };
}

/** A control's fill, once it has eased to it. */
const fill = (control: Locator) =>
  control.evaluate(async (element) => {
    await Promise.all(element.getAnimations().map(({ finished }) => finished));
    return getComputedStyle(element).backgroundColor;
  });

describe("the toolbar", () => {
  it("offers Record when not recording, and sends it when pressed", async () => {
    const { call, sent, tell } = scriptedPage();
    mount(call);

    tell({ phase: "notRecording", commands: ["record"] });

    await expect.poll(() => toolbar.offered()).toEqual(["Record"]);
    expect(await toolbar.assertVisibility.isEnabled()).toBe(false);
    await toolbar.recordButton.click();
    expect(sent).toEqual([{ type: "record" }]);
  });

  it("holds only the control that records, stops or continues, and Assert visibility: no Clear, Finish or status", async () => {
    const { call, sent, tell } = scriptedPage();
    mount(call);

    tell({
      phase: "recording",
      picking: true,
      commands: ["stop", "clear", "finish", "leaveAssertVisibility"],
    } as Partial<RecorderState>);

    await expect.poll(() => toolbar.picking()).toBe(true);
    expect(await toolbar.offered()).toEqual(["Stop"]);
    expect(await toolbar.root.locator("button").count()).toBe(2);
    expect(await toolbar.root.textContent()).toBe("");
    await toolbar.assertVisibility.click();
    await toolbar.stopButton.click();
    expect(sent).toEqual([{ type: "leaveAssertVisibility" }, { type: "stop" }]);
  });

  it("offers Continue recording while paused", async () => {
    const { call, sent, tell } = scriptedPage();
    mount(call);

    tell({ phase: "paused", commands: ["continue", "clear", "finish"] });

    await expect.poll(() => toolbar.offered()).toEqual(["Continue recording"]);
    await toolbar.continueButton.click();
    expect(sent).toEqual([{ type: "continue" }]);
  });

  it("lights Stop while recording, and Assert visibility as Stop while Playwright picks", async () => {
    const { call, tell } = scriptedPage();
    mount(call);
    tell({ phase: "notRecording", commands: ["record"] });
    await expect.poll(() => toolbar.offered()).toEqual(["Record"]);
    const unlit = await fill(toolbar.recordButton);

    tell({ phase: "recording", commands: ["stop", "assertVisibility"] });
    await expect.poll(() => toolbar.offered()).toEqual(["Stop"]);
    const lit = await fill(toolbar.stopButton);
    expect(lit).not.toBe(unlit);
    expect(await fill(toolbar.assertVisibility)).toBe(unlit);

    tell({
      phase: "recording",
      picking: true,
      commands: ["stop", "leaveAssertVisibility"],
    } as Partial<RecorderState>);
    await expect.poll(() => toolbar.picking()).toBe(true);
    expect(await fill(toolbar.assertVisibility)).toBe(lit);
  });

  it("says, in place of its first control, that the recorder wraps up, and offers nothing meanwhile", async () => {
    const { call, tell } = scriptedPage();
    mount(call);

    tell({ phase: "wrappingUp", then: "pause" } as Partial<RecorderState>);

    await expect.poll(() => toolbar.busy()).toBe("Wrapping up, then pausing");
    expect(await toolbar.offered()).toEqual([]);
    expect(await toolbar.busyIndicator.isEnabled()).toBe(false);
    // Hovered, it says so too.
    expect(await toolbar.busyIndicator.getAttribute("title")).toBe(
      "Wrapping up, then pausing"
    );

    tell({ phase: "paused", commands: ["continue"] });
    await expect.poll(() => toolbar.busy()).toBeNull();
  });

  it("sits at the top centre of the page, apart from the page's structure, layout and styles", async () => {
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
    expect(box.y).toBe(12);
    expect(
      Math.abs(box.x + box.width / 2 - innerWidth / 2)
    ).toBeLessThanOrEqual(0.5);
  });

  it("follows the system's colour scheme live", async () => {
    const system = scheme(true);
    const { call, tell } = scriptedPage();
    mount(call);
    tell({ phase: "notRecording", commands: ["record"] });
    const dark = () =>
      toolbar.root.evaluate((root) => root.closest(".dark") !== null);

    await expect.poll(() => toolbar.offered()).toEqual(["Record"]);
    expect(await dark()).toBe(true);
    system.set(false);
    await expect.poll(dark).toBe(false);
    system.set(true);
    await expect.poll(dark).toBe(true);
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
    // The gap between its two buttons.
    const first = (await toolbar.recordButton.boundingBox())!;
    const second = (await toolbar.assertVisibility.boundingBox())!;
    const errors = pageErrors();

    await userEvent.click(host, {
      position: {
        x: (first.x + first.width + second.x) / 2,
        y: first.y + first.height / 2,
      },
      force: true,
    });

    expect(sent).toEqual([]);
    expect(errors).toEqual([]);
  });

  /** Every input the page hears on its document, trusted or not: the
   * click the toolbar gives its own button included, which a page that
   * closes a panel on a click elsewhere would take for one. */
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
    const listener = (event: Event) => heard.push(event.type);
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
    tell({ phase: "recording", commands: ["stop"] });
    await expect.poll(() => toolbar.offered()).toEqual(["Stop"]);
    const field = document.createElement("input");
    document.body.append(field);
    removals.push(() => field.remove());
    field.focus();
    const heard = pageListens();
    const errors = pageErrors();

    await personClicks(host, toolbar.stopButton);

    expect(sent).toEqual([{ type: "stop" }]);
    expect(heard).toEqual([]);
    expect(errors).toEqual([]);
    expect(document.activeElement).toBe(field);
  });

  it("presses nothing that cannot be pressed now", async () => {
    const { call, sent, tell } = scriptedPage();
    const host = mount(call);
    // Not recording, and Record not offered: nothing applies.
    tell({ phase: "notRecording", commands: [] });
    await expect.poll(() => toolbar.recordButton.isEnabled()).toBe(false);
    const heard = pageListens();

    await personClicks(host, toolbar.recordButton);
    await personClicks(host, toolbar.assertVisibility);

    expect(sent).toEqual([]);
    expect(heard).toEqual([]);
  });

  /** The middle of the Record button, with the toolbar showing it. */
  async function recordButton() {
    const { call, tell } = scriptedPage();
    const host = mount(call);
    tell({ phase: "notRecording", commands: ["record"] });
    await expect.poll(() => toolbar.offered()).toEqual(["Record"]);
    const box = (await toolbar.recordButton.boundingBox())!;
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
