import type {
  CommandResult,
  EntryId,
  RecordedVisit,
  RecorderCommand,
  RecorderState,
  RecorderUpdate,
} from "@ayme-dev/recorder/contract";
import { createPage } from "@ayme-dev/playwright-lite";
import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import type { RecorderChannel } from "../channel";
import { RecorderWindow } from "../testing";
import { channelUrl, mountWindow } from "./mountWindow";
import { entryId } from "../test-utils/ids";

// Component tests: the recorder window, mounted as its script mounts it,
// showing what a scripted channel tells, and read and pressed through its
// page objects on playwright-lite, as a person would use it.

const page = createPage();
const recorderWindow = new RecorderWindow(page);
const unmounts: (() => void)[] = [];

afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
  document.documentElement.classList.remove("dark");
  localStorage.clear();
  vi.restoreAllMocks();
});

/** A channel the test plays: it tells states, and keeps what is sent. */
function scriptedChannel(
  answer: () => Promise<CommandResult> = async () => "applied"
) {
  const listeners = new Set<(update: RecorderUpdate) => void>();
  const sent: RecorderCommand[] = [];
  let revision = 0;
  let latest: RecorderUpdate | undefined;
  const channel: RecorderChannel = {
    send: (command) => {
      sent.push(command);
      return answer();
    },
    // As the recorder's channel does, a subscriber hears the full state
    // first.
    subscribe(listener) {
      listeners.add(listener);
      if (latest) listener(latest);
      return () => listeners.delete(listener);
    },
  };
  return {
    channel,
    sent,
    /** Tells the window a state, under the next revision or the one given. */
    tell(state: Partial<RecorderState>, at = ++revision) {
      const update = {
        revision: at,
        state: { visits: [], commands: [], warnings: [], ...state },
      } as unknown as RecorderUpdate;
      latest = update;
      for (const listener of listeners) listener(update);
    },
  };
}

function mount(channel: RecorderChannel) {
  const root = document.createElement("div");
  document.body.append(root);
  const unmount = mountWindow(root, channel);
  unmounts.push(() => {
    unmount();
    root.remove();
  });
}

/** The system's colour scheme, played by the test: it can change while the
 * window is open. */
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

const isDark = () => document.documentElement.classList.contains("dark");

const login: RecordedVisit = {
  visitId: "visit_1",
  url: "http://shop.test/",
  cause: "initial",
  entries: [
    {
      kind: "interaction",
      id: entryId("interaction_1"),
      timestamp: 10,
      interaction: {
        id: entryId("interaction_1"),
        type: "fill",
        text: "secret_sauce",
        targetRef: "e3",
        targetSelector: '[data-test="password"]',
      },
      targetElement: 'textbox "Password"',
      changes: [
        {
          kind: "changed",
          element: 'textbox "Password"',
          changed: [{ property: "text", to: "secret_sauce" }],
        },
      ],
    },
  ],
};
const inventory: RecordedVisit = {
  visitId: "visit_2",
  url: "http://shop.test/inventory",
  cause: "navigate",
  entries: [
    {
      kind: "interaction",
      id: entryId("interaction_2"),
      timestamp: 20,
      interaction: {
        id: entryId("interaction_2"),
        type: "click",
        targetRef: "e9",
        targetSelector: '[data-test="add-to-cart"]',
      },
      targetElement: 'button "Add to cart"',
      changes: [
        { kind: "added", element: 'button "Remove"' },
        {
          kind: "changed",
          element: 'link "Cart"',
          changed: [{ property: "active", to: "true" }],
        },
      ],
    },
    {
      kind: "change",
      id: entryId("change_1"),
      timestamp: 30,
      changes: [{ kind: "removed", element: 'status "Saved"' }],
    },
    {
      kind: "interaction",
      id: entryId("interaction_3"),
      timestamp: 40,
      interaction: {
        id: entryId("interaction_3"),
        type: "assertVisible",
        targetRef: null,
        targetSelector: '[data-test="title"]',
      },
      changes: null,
    },
  ],
};

/** The window, its Visits read as a person reads them. */
async function visits() {
  return recorderWindow.timeline.visits();
}

it("says it is connecting, offers nothing and shows no Visit until the recorder's state comes", async () => {
  const { channel } = scriptedChannel();
  mount(channel);

  await expect
    .poll(() => recorderWindow.controls.status.textContent())
    .toBe("Connecting…");
  expect(await recorderWindow.controls.offered()).toEqual([]);
  expect(await recorderWindow.timeline.empty.textContent()).toBe(
    "No interactions recorded yet."
  );
});

it("offers Record when not recording, says nothing more, and sends Record when pressed", async () => {
  const { channel, sent, tell } = scriptedChannel();
  mount(channel);

  tell({ phase: "notRecording", commands: ["record"] });

  await expect
    .poll(() => recorderWindow.controls.offered())
    .toEqual(["Record"]);
  expect(await recorderWindow.controls.status.textContent()).toBe("");
  await recorderWindow.controls.recordButton.click();
  expect(sent).toEqual([{ type: "record" }]);
});

it("shows each Visit with its entries: their targets by role and name, and what changed in words", async () => {
  const { channel, tell } = scriptedChannel();
  mount(channel);

  tell({ phase: "recording", visits: [login, inventory], commands: ["stop"] });

  await expect.poll(async () => (await visits()).length).toBe(2);
  const [first, second] = await visits();
  expect(await first!.heading.textContent()).toBe("Page 1");
  expect(await first!.start.textContent()).toBe(
    "Navigated to http://shop.test/"
  );
  const [fill] = await first!.entries();
  expect(await fill!.title.textContent()).toBe("Fill 'secret_sauce'");
  expect(await fill!.target.textContent()).toBe("textbox “Password”");
  // The selector shows on hover.
  expect(await fill!.target.getAttribute("title")).toBe(
    '[data-test="password"]'
  );
  expect(await fill!.whatChanged()).toEqual([
    {
      element: "textbox “Password”",
      effect: "text changed from empty to “secret_sauce”",
    },
  ]);
  const [click, change, assertion] = await second!.entries();
  expect(await click!.whatChanged()).toEqual([
    { element: "button “Remove”", effect: "appeared" },
    { element: "link “Cart”", effect: "became active" },
  ]);
  expect(await change!.title.textContent()).toBe("Element removed");
  expect(await change!.target.count()).toBe(0);
  expect(await assertion!.title.textContent()).toBe("Assert");
  // A target the page's structure does not name shows its selector.
  expect(await assertion!.target.textContent()).toBe('[data-test="title"]');
  expect(await assertion!.target.getAttribute("title")).toBeNull();
  expect(await recorderWindow.timeline.empty.count()).toBe(0);
});

it("joins each icon of a Visit to the next by a line", async () => {
  const { channel, tell } = scriptedChannel();
  mount(channel);

  tell({ phase: "recording", visits: [login, inventory], commands: ["stop"] });

  await expect.poll(async () => (await visits()).length).toBe(2);
  // A line below every icon but the last of its Visit: 1 in the first
  // Visit (its start, to its one entry) and 3 in the second.
  expect(await recorderWindow.timeline.lines.count()).toBe(4);
});

it("highlights the element of a chip of the page now open while it is hovered, and clears it when left", async () => {
  const { channel, sent, tell } = scriptedChannel();
  mount(channel);
  tell({
    phase: "recording",
    visits: [login, inventory],
    commands: ["stop", "highlight", "clearHighlight"],
  });
  await expect.poll(async () => (await visits()).length).toBe(2);
  const [click] = await (await visits())[1]!.entries();
  const [, second] = await click!.changes();

  await click!.target.hover();
  await second!.element.hover();
  await click!.title.hover();

  expect(sent).toEqual([
    { type: "highlight", entry: entryId("interaction_2") },
    { type: "clearHighlight" },
    { type: "highlight", entry: entryId("interaction_2"), row: 1 },
    { type: "clearHighlight" },
  ]);
});

it("leaves the chips of an earlier Visit inert, and asks for no highlight when it does not apply", async () => {
  const { channel, sent, tell } = scriptedChannel();
  mount(channel);
  tell({
    phase: "recording",
    visits: [login, inventory],
    commands: ["stop", "highlight", "clearHighlight"],
  });
  await expect.poll(async () => (await visits()).length).toBe(2);
  const [fill] = await (await visits())[0]!.entries();
  const [row] = await fill!.changes();

  await fill!.target.hover();
  await row!.element.hover();
  await fill!.title.hover();
  tell({ phase: "paused", visits: [login, inventory], commands: ["continue"] });
  const [click] = await (await visits())[1]!.entries();
  await click!.target.hover();
  await click!.title.hover();

  expect(sent).toEqual([]);
});

it("offers Stop, Assert visibility, Clear and Finish while recording, and sends each", async () => {
  const { channel, sent, tell } = scriptedChannel();
  mount(channel);

  tell({
    phase: "recording",
    commands: ["stop", "clear", "finish", "assertVisibility"],
  });

  await expect
    .poll(() => recorderWindow.controls.offered())
    .toEqual(["Stop", "Clear", "Finish"]);
  expect(await recorderWindow.controls.status.textContent()).toBe("");
  expect(await recorderWindow.controls.assertVisibility.isEnabled()).toBe(true);
  expect(await recorderWindow.controls.picking()).toBe(false);
  await recorderWindow.controls.stopButton.click();
  await recorderWindow.controls.assertVisibility.click();
  await recorderWindow.controls.clearButton.click();
  await recorderWindow.controls.finishButton.click();
  expect(sent).toEqual([
    { type: "stop" },
    { type: "assertVisibility" },
    { type: "clear" },
    { type: "finish" },
  ]);
});

/** A control's fill, once it has eased to it. */
const fill = (control: RecorderWindow["controls"]["assertVisibility"]) =>
  control.evaluate(async (element) => {
    await Promise.all(element.getAnimations().map(({ finished }) => finished));
    return getComputedStyle(element).backgroundColor;
  });

/** A person's pointer over an entry's title, as trusted input: only that
 * makes the page's hover styles apply. */
const personHovers = (entry: EntryId) =>
  userEvent.hover(document.querySelector(`[data-entry="${entry}"] h3`)!);

it("shows Assert visibility filled while Playwright picks, and leaves it when pressed", async () => {
  const { channel, sent, tell } = scriptedChannel();
  mount(channel);
  tell({ phase: "recording", commands: ["stop", "assertVisibility"] });
  await expect.poll(() => recorderWindow.controls.picking()).toBe(false);
  const off = await fill(recorderWindow.controls.assertVisibility);

  tell({
    phase: "recording",
    picking: true,
    commands: ["stop", "leaveAssertVisibility"],
  } as Partial<RecorderState>);

  await expect.poll(() => recorderWindow.controls.picking()).toBe(true);
  await expect
    .poll(() => fill(recorderWindow.controls.assertVisibility))
    .not.toBe(off);
  await recorderWindow.controls.assertVisibility.click();
  expect(sent).toEqual([{ type: "leaveAssertVisibility" }]);
});

it("offers Continue recording while paused, and a quiet Discard on an entry only while it is hovered or has focus", async () => {
  const { channel, sent, tell } = scriptedChannel();
  mount(channel);
  tell({
    phase: "paused",
    visits: [inventory],
    commands: ["continue", "clear", "finish", "discard", "restore"],
  });
  await expect
    .poll(() => recorderWindow.controls.offered())
    .toEqual(["Continue recording", "Clear", "Finish"]);
  const [click, change] = await (await visits())[0]!.entries();
  const shown = (entry: typeof click) =>
    entry!.discardButton.evaluate(async (button) => {
      await Promise.all(button.getAnimations().map(({ finished }) => finished));
      return getComputedStyle(button).opacity;
    });

  await expect.poll(() => shown(click)).toBe("0");
  await personHovers(entryId("interaction_2"));
  await expect.poll(() => shown(click)).toBe("1");
  // A keyboard reaches it too: it is in the Tab order, and shows on focus.
  expect(await change!.discardButton.getAttribute("tabindex")).toBeNull();
  await change!.discardButton.focus();
  await expect.poll(() => shown(change)).toBe("1");

  await click!.discardButton.click();
  await recorderWindow.controls.continueButton.click();
  expect(sent).toEqual([
    { type: "discard", entry: entryId("interaction_2") },
    { type: "continue" },
  ]);
});

it("strikes a discarded entry through, hides what it changed, and restores it from its undo icon", async () => {
  const { channel, sent, tell } = scriptedChannel();
  mount(channel);
  const discarded: RecordedVisit = {
    ...inventory,
    entries: [
      { ...inventory.entries[0]!, discarded: true },
      ...inventory.entries.slice(1),
    ],
  };

  tell({
    phase: "paused",
    visits: [discarded],
    commands: ["continue", "discard", "restore"],
  });

  await expect.poll(async () => (await visits()).length).toBe(1);
  const [click, change] = await (await visits())[0]!.entries();
  await expect.poll(() => click!.looksDiscarded()).toBe(true);
  expect(await click!.whatChangedList.count()).toBe(0);
  expect(await click!.discardButton.count()).toBe(0);
  expect(await change!.looksDiscarded()).toBe(false);
  expect(await change!.restoreButton.count()).toBe(0);
  await click!.restoreButton.click();
  expect(sent).toEqual([{ type: "restore", entry: entryId("interaction_2") }]);
});

it("offers neither Discard nor Restore while recording", async () => {
  const { channel, tell } = scriptedChannel();
  mount(channel);

  tell({ phase: "recording", visits: [inventory], commands: ["stop"] });

  await expect.poll(async () => (await visits()).length).toBe(1);
  const [click] = await (await visits())[0]!.entries();
  expect(await click!.discardButton.count()).toBe(0);
  expect(await click!.restoreButton.count()).toBe(0);
});

it("keeps showing the newest state when an older one comes late", async () => {
  const { channel, tell } = scriptedChannel();
  mount(channel);
  tell({ phase: "recording", commands: ["stop"] }, 5);
  await expect.poll(() => recorderWindow.controls.offered()).toEqual(["Stop"]);

  tell({ phase: "notRecording", commands: ["record"] }, 3);
  // Time for the window to show it, were it to.
  await new Promise((resolve) => setTimeout(resolve, 100));

  expect(await recorderWindow.controls.offered()).toEqual(["Stop"]);
});

it("says that it wraps up, and offers nothing meanwhile", async () => {
  const { channel, tell } = scriptedChannel();
  mount(channel);

  tell({ phase: "wrappingUp", then: "pause" } as Partial<RecorderState>);

  await expect
    .poll(() => recorderWindow.controls.status.textContent())
    .toBe("Wrapping up, then pausing");
  expect(await recorderWindow.controls.offered()).toEqual([]);
});

it("says where an ended recorder saved its package, and offers nothing more", async () => {
  const { channel, tell } = scriptedChannel();
  mount(channel);

  tell({
    phase: "ended",
    outcome: { kind: "saved", folder: "/project/.ayme/recordings/rec_1" },
  } as Partial<RecorderState>);

  await expect
    .poll(() => recorderWindow.controls.status.textContent())
    .toBe("Saved /project/.ayme/recordings/rec_1/package.yaml");
  expect(await recorderWindow.controls.offered()).toEqual([]);
  expect(await recorderWindow.controls.assertVisibility.isEnabled()).toBe(
    false
  );
});

it("goes on after a command the recorder could not be asked", async () => {
  const { channel, sent, tell } = scriptedChannel(() =>
    Promise.reject(new Error("The channel is closed."))
  );
  mount(channel);
  tell({ phase: "notRecording", commands: ["record"] });
  await expect
    .poll(() => recorderWindow.controls.offered())
    .toEqual(["Record"]);

  await recorderWindow.controls.recordButton.click();
  tell({ phase: "recording", commands: ["stop"] });

  await expect.poll(() => recorderWindow.controls.offered()).toEqual(["Stop"]);
  expect(sent).toEqual([{ type: "record" }]);
});

it("follows the system's scheme live, as long as no theme is chosen", async () => {
  const system = scheme(false);
  const { channel, tell } = scriptedChannel();
  mount(channel);
  tell({ phase: "notRecording", commands: ["record"] });
  await expect.poll(() => recorderWindow.controls.theme()).toBe("System");
  expect(isDark()).toBe(false);

  system.set(true);
  await expect.poll(isDark).toBe(true);
  system.set(false);
  await expect.poll(isDark).toBe(false);
});

it("takes the theme chosen with its switch, and keeps it when it opens again", async () => {
  const system = scheme(false);
  const { channel, tell } = scriptedChannel();
  mount(channel);
  tell({ phase: "notRecording", commands: ["record"] });

  await recorderWindow.controls.chooseTheme("Dark");
  expect(isDark()).toBe(true);
  system.set(false);
  expect(isDark()).toBe(true);
  await recorderWindow.controls.chooseTheme("Light");
  system.set(true);
  expect(isDark()).toBe(false);

  for (const unmount of unmounts.splice(0)) unmount();
  mount(scriptedChannel().channel);
  await expect.poll(() => recorderWindow.controls.theme()).toBe("Light");
  expect(isDark()).toBe(false);
});

it("names the page the recording is on now in its title", async () => {
  const { channel, tell } = scriptedChannel();
  mount(channel);
  tell({ phase: "notRecording", commands: ["record"] });
  await expect.poll(() => document.title).toBe("Ayme Recorder");

  tell({ phase: "recording", visits: [login], commands: ["stop"] });
  await expect
    .poll(() => document.title)
    .toBe("Ayme Recorder - http://shop.test/");
  tell({ phase: "recording", visits: [login, inventory], commands: ["stop"] });
  await expect
    .poll(() => document.title)
    .toBe("Ayme Recorder - http://shop.test/inventory");
});

it("leaves nothing of its stylesheet in the document once it is taken out", async () => {
  const before = document.head.innerHTML;
  const root = document.createElement("div");
  document.body.append(root);
  const { channel, tell } = scriptedChannel();
  const unmount = mountWindow(root, channel);
  tell({ phase: "notRecording", commands: ["record"] });
  await expect
    .poll(() => recorderWindow.controls.offered())
    .toEqual(["Record"]);

  unmount();
  root.remove();

  expect(document.head.innerHTML).toBe(before);
  expect(await recorderWindow.controls.recordButton.count()).toBe(0);
});

it("opens its channel on the server that serves it, at /channel", () => {
  expect(channelUrl({ host: "127.0.0.1:53124" })).toBe(
    "ws://127.0.0.1:53124/channel"
  );
});
