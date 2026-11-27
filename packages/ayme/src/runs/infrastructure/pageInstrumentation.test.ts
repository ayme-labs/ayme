import type { AriaRef } from "@ayme-dev/core/structural-observation";
import type { Locator } from "@playwright/test";
import { afterEach, expect, it, vi } from "vitest";

import {
  installRuntimePageInstrumentation,
  instrumentedPage,
} from "./pageInstrumentation";
import type { AymePage } from "../../runtime";

/** What the page state gave the element a locator matches: no ref until a test says. */
const latestPageStateRefOf = vi.fn<
  (locator: Locator) => Promise<AriaRef | undefined>
>(async () => undefined);
const noRef = latestPageStateRefOf;

type FakeLocator = {
  selector: string;
  click(): void;
  evaluateAll(): void;
  nth(index: number): FakeLocator;
  all(): Promise<FakeLocator[]>;
  page(): FakePage;
};
type FakePage = {
  locator(selector: string): FakeLocator;
  keyboard: { press(key: string): void };
  mouse: { click(x: number, y: number): void };
};

const clicks: string[] = [];
// A Page whose locators record their clicks, tagged with how they were made.
function fakePage(by: string): FakePage {
  const page: FakePage = {
    locator: (selector) => {
      const locator: FakeLocator = {
        selector,
        click: () => clicks.push(`${by} ${selector}`),
        evaluateAll: () => {},
        nth: (index) => page.locator(`${selector} >> nth=${index}`),
        all: async () => [locator.nth(0)],
        page: () => page,
      };
      return locator;
    },
    keyboard: { press: (key) => clicks.push(`${by} keyboard ${key}`) },
    mouse: { click: (x, y) => clicks.push(`${by} mouse ${x},${y}`) },
  };
  return page;
}
const page = fakePage("raw") as unknown as AymePage;
const traced = fakePage("traced") as unknown as AymePage;
const lateButton = () =>
  instrumentedPage(page, undefined, noRef).locator(
    "button"
  ) as unknown as FakeLocator;
let uninstall = () => {};
const installTracing = () => {
  uninstall = installRuntimePageInstrumentation(() => traced);
};

afterEach(() => {
  uninstall();
  clicks.length = 0;
  vi.clearAllMocks();
});

it("reads the ref of a locator's element in the page before its click reaches it", async () => {
  latestPageStateRefOf.mockResolvedValueOnce("e7" as AriaRef);
  const heard = vi.fn(() => expect(clicks).toEqual([]));

  await instrumentedPage(page, heard, noRef).locator("button").click();

  expect(heard).toHaveBeenCalledWith(
    expect.objectContaining({ operation: "click", ref: "e7" })
  );
  expect(latestPageStateRefOf).toHaveBeenCalledWith(
    expect.objectContaining({ selector: "button" })
  );
  expect(clicks).toEqual(["raw button"]);
});

it("records no ref, and still makes the input, when the page names none or reading it fails", async () => {
  const heard = vi.fn();
  const button = instrumentedPage(page, heard, noRef).locator("button");

  latestPageStateRefOf.mockResolvedValueOnce(undefined);
  await button.click();
  latestPageStateRefOf.mockRejectedValueOnce(new Error("unresolved"));
  await button.click();

  expect(heard).toHaveBeenCalledTimes(2);
  for (const [interaction] of heard.mock.calls)
    expect(interaction).not.toHaveProperty("ref");
  expect(clicks).toEqual(["raw button", "raw button"]);
});

it("makes a call that is no Interaction at once, reading nothing", () => {
  const heard = vi.fn();

  (instrumentedPage(page, heard, noRef) as unknown as FakePage)
    .locator("button")
    .evaluateAll();

  expect(heard).not.toHaveBeenCalled();
  expect(latestPageStateRefOf).not.toHaveBeenCalled();
});

it("routes a locator derived before an instrumentation was installed through it", () => {
  const button = lateButton();
  button.click();
  installTracing();
  button.click();
  uninstall();
  button.click();
  expect(clicks).toEqual(["raw button", "traced button", "raw button"]);
});

it("routes a method saved before an instrumentation was installed through it", () => {
  const button = lateButton();
  const click = button.click.bind(button);
  installTracing();
  click();
  expect(clicks).toEqual(["traced button"]);
});

it("routes all()'s items and a locator's page through a later instrumentation", async () => {
  const button = lateButton();
  const [first] = await button.all();
  const owner = button.page();
  installTracing();
  first!.click();
  owner.locator("link").click();
  expect(clicks).toEqual(["traced button >> nth=0", "traced link"]);
});

it("routes a keyboard and a mouse saved before an instrumentation was installed through it", () => {
  const { keyboard, mouse } = instrumentedPage(
    page,
    undefined,
    noRef
  ) as unknown as FakePage;
  keyboard.press("a");
  installTracing();
  keyboard.press("b");
  mouse.click(1, 2);
  uninstall();
  keyboard.press("c");
  expect(clicks).toEqual([
    "raw keyboard a",
    "traced keyboard b",
    "traced mouse 1,2",
    "raw keyboard c",
  ]);
});

/** A Host's decision on each call, which a test changes between calls. */
function hostDeciding() {
  const host = {
    decision: "start" as "start" | "refuse" | Promise<void>,
    asked: 0,
    run: <T>(action: () => T) => action(),
    stopped: () => undefined,
    bound: [] as unknown[],
    bind: <F>(listener: F) => {
      host.bound.push(listener);
      return listener;
    },
    before: () => {
      host.asked += 1;
      if (host.decision === "refuse") throw new Error("refused");
      return host.decision === "start" ? undefined : host.decision;
    },
  };
  return host;
}

/** Reading the ref of the next locator's element waits until the test
 * calls the function this returns. */
function holdRefRead() {
  let read = () => {};
  latestPageStateRefOf.mockImplementationOnce(
    () => new Promise((resolve) => (read = () => resolve(undefined)))
  );
  return () => read();
}

it("asks its Host again right before an input is sent, after reading its element's ref, and sends none it refuses", async () => {
  const readRef = holdRefRead();
  const host = hostDeciding();
  const heard = vi.fn();
  const button = instrumentedPage(page, heard, noRef, host).locator("button");
  host.asked = 0;
  const click = button.click();
  await Promise.resolve();
  expect(host.asked).toBe(1);

  // A dialog counts while the ref is read.
  host.decision = "refuse";
  readRef();

  await expect(click).rejects.toThrow("refused");
  expect(host.asked).toBe(2);
  expect(clicks).toEqual([]);
  expect(heard).not.toHaveBeenCalled();
});

it("holds an input its Host holds right before it is sent, until the Host lets it start", async () => {
  const readRef = holdRefRead();
  const host = hostDeciding();
  const click = instrumentedPage(page, vi.fn(), noRef, host)
    .locator("button")
    .click();
  await Promise.resolve();
  let letStart = () => {};
  host.decision = new Promise((resolve) => (letStart = resolve));
  readRef();
  for (let turn = 0; turn < 10; turn++) await Promise.resolve();
  expect(clicks).toEqual([]);

  host.decision = "start";
  letStart();
  await click;

  expect(clicks).toEqual(["raw button"]);
});

/** An object of Playwright's client, which talks to the browser over its
 * connection: async methods that reach the browser record what they did. */
function clientObject<T extends object>(type: string, members: T) {
  return Object.assign(Object.create({}), members, {
    _guid: `${type}@1`,
    _type: type,
    _connection: {},
  }) as T;
}

/** A FrameLocator as Playwright makes one: no connection of its own, it
 * holds the Frame it reaches the browser through. */
class FakeFrameLocator {
  constructor(readonly _frame: { click(selector: string): Promise<void> }) {}
  locator(selector: string) {
    return clientObject("Locator-holder", {
      click: async () => void (await this._frame.click(`iframe ${selector}`)),
    });
  }
}

/** A Page with the handles an action may keep: a Frame, an ElementHandle,
 * the context, a dialog it waits for, and the events it listens to. */
function pageWithHandles() {
  const listeners = new Map<string, ((value: unknown) => void)[]>();
  const frame = clientObject("Frame", {
    click: async (selector: string) => void clicks.push(`frame ${selector}`),
    name: () => "main",
  });
  const handle = clientObject("ElementHandle", {
    click: async () => void clicks.push("handle"),
  });
  const dialog = clientObject("Dialog", {
    accept: async () => void clicks.push("dialog accepted"),
  });
  const popup = clientObject("Page", {
    click: async (selector: string) => void clicks.push(`popup ${selector}`),
  });
  const raw = {
    mainFrame: () => frame,
    frameLocator: () => new FakeFrameLocator(frame),
    $: async () => handle,
    waitForEvent: async () => dialog,
    context: () => clientObject("BrowserContext", { pages: () => [raw] }),
    on: (event: string, listener: (value: unknown) => void) =>
      void listeners.set(event, [...(listeners.get(event) ?? []), listener]),
    off: (event: string, listener: (value: unknown) => void) =>
      void listeners.set(
        event,
        (listeners.get(event) ?? []).filter((each) => each !== listener)
      ),
  };
  const emit = (event: string, value: unknown) => {
    for (const listener of listeners.get(event) ?? []) listener(value);
  };
  return { raw, frame, popup, emit, listeners };
}

type PageWithHandles = ReturnType<typeof pageWithHandles>["raw"];

it("a Frame, a frame's locator and an ElementHandle an action kept are refused once its Host refuses, like the Page", async () => {
  const { raw } = pageWithHandles();
  const host = hostDeciding();
  const wrapped = instrumentedPage(
    raw as unknown as AymePage,
    undefined,
    noRef,
    host
  ) as unknown as PageWithHandles;
  const frame = wrapped.mainFrame();
  const inFrame = wrapped.frameLocator().locator("#mark");
  const handle = await wrapped.$();

  host.decision = "refuse";

  await expect(frame.click("#save")).rejects.toThrow("refused");
  await expect(inFrame.click()).rejects.toThrow("refused");
  await expect(handle!.click()).rejects.toThrow("refused");
  expect(() => frame.name()).toThrow("refused");
  expect(clicks).toEqual([]);
});

it("a kept Frame's call waits while its Host holds it, and its answers stay the same object", async () => {
  const { raw } = pageWithHandles();
  const host = hostDeciding();
  const wrapped = instrumentedPage(
    raw as unknown as AymePage,
    undefined,
    noRef,
    host
  ) as unknown as PageWithHandles;
  const frame = wrapped.mainFrame();
  expect(wrapped.mainFrame()).toBe(frame);
  expect(wrapped.context().pages()).toEqual([wrapped]);
  let letStart = () => {};
  host.decision = new Promise((resolve) => (letStart = resolve));

  const click = frame.click("#save");
  for (let turn = 0; turn < 10; turn++) await Promise.resolve();
  expect(clicks).toEqual([]);
  host.decision = "start";
  letStart();
  await click;

  expect(clicks).toEqual(["frame #save"]);
});

it("a Dialog's answer is never held, and is refused once its Host refuses", async () => {
  const { raw } = pageWithHandles();
  const host = hostDeciding();
  const wrapped = instrumentedPage(
    raw as unknown as AymePage,
    undefined,
    noRef,
    host
  ) as unknown as PageWithHandles;
  const dialog = await wrapped.waitForEvent();

  host.decision = new Promise(() => {});
  await dialog.accept();
  host.decision = "refuse";

  await expect(dialog.accept()).rejects.toThrow("refused");
  expect(clicks).toEqual(["dialog accepted"]);
});

it("what a listener is handed carries the check, and the listener is removed by the function the action registered", async () => {
  const { raw, popup, emit, listeners } = pageWithHandles();
  const host = hostDeciding();
  const wrapped = instrumentedPage(
    raw as unknown as AymePage,
    undefined,
    noRef,
    host
  ) as unknown as PageWithHandles;
  const heard: { click(selector: string): Promise<void> }[] = [];
  const listener = (value: unknown) =>
    void heard.push(value as (typeof heard)[number]);
  wrapped.on("popup", listener);
  expect(host.bound).toEqual([listener]);
  emit("popup", popup);

  wrapped.off("popup", listener);
  expect(listeners.get("popup")).toEqual([]);

  host.decision = "refuse";
  await expect(heard[0]!.click("#buy")).rejects.toThrow("refused");
  expect(clicks).toEqual([]);
});

it("without a Host that decides, Playwright's own objects are handed out as they are", () => {
  const { raw, frame } = pageWithHandles();
  const wrapped = instrumentedPage(
    raw as unknown as AymePage,
    undefined,
    noRef
  ) as unknown as PageWithHandles;

  expect(wrapped.mainFrame()).toBe(frame);
});
