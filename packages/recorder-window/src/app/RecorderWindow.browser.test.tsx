import type {
  CommandResult,
  RecordedVisit,
  RecorderCommand,
  RecorderState,
  RecorderUpdate,
} from "@ayme-dev/recorder/contract";
import { createPage } from "@ayme-dev/playwright-lite";
import { afterEach, expect, it, vi } from "vitest";

import type { RecorderChannel } from "../channel";
import { RecorderWindow } from "../testing";
import { channelUrl, mountWindow } from "./mountWindow";

// Component tests: the recorder window, mounted as its script mounts it,
// showing what a scripted channel tells, and read and pressed through its
// page objects on playwright-lite, as a person would use it.

const page = createPage();
const recorderWindow = new RecorderWindow(page);
const unmounts: (() => void)[] = [];

afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
  document.documentElement.classList.remove("dark");
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

const cart: RecordedVisit = {
  visitId: "visit_1",
  url: "http://shop.test/cart",
  cause: "initial",
  entries: [
    {
      kind: "interaction",
      id: "interaction_1",
      timestamp: 10,
      interaction: {
        id: "interaction_1",
        type: "click",
        targetRef: "e2",
        targetSelector: 'internal:role=button[name="Add item"i]',
      },
      changeTree: [
        "- [ref=e1]:",
        '  - <added> [ref=e3] list "Cart":',
        "    - <added> [ref=e4] listitem: Milk",
      ].join("\n"),
    },
    {
      kind: "change",
      id: "change_1",
      timestamp: 20,
      changeTree: '- [ref=e1]:\n  - <removed> [ref=e5] status: "Saved"',
    },
  ],
};
const checkout: RecordedVisit = {
  visitId: "visit_2",
  url: "http://shop.test/checkout",
  cause: "openPage",
  entries: [],
};

it("says it is connecting, offers nothing and shows no Visit until the recorder's state comes", async () => {
  const { channel } = scriptedChannel();
  mount(channel);

  await expect
    .poll(() => recorderWindow.controls.status.textContent())
    .toBe("Connecting…");
  expect(await recorderWindow.controls.offered()).toEqual([]);
  expect(await recorderWindow.timeline.empty.isVisible()).toBe(true);
});

it("offers Record when not recording, and sends it when pressed", async () => {
  const { channel, sent, tell } = scriptedChannel();
  mount(channel);

  tell({ phase: "notRecording", commands: ["record"] });

  await expect
    .poll(() => recorderWindow.controls.status.textContent())
    .toBe("Not recording");
  expect(await recorderWindow.controls.offered()).toEqual(["Record"]);
  await recorderWindow.controls.press("Record");
  expect(sent).toEqual([{ type: "record" }]);
});

it("shows each Visit with its entries, their targets and only the roots of what they changed", async () => {
  const { channel, tell } = scriptedChannel();
  mount(channel);

  tell({ phase: "recording", visits: [cart, checkout], commands: ["stop"] });

  const first = recorderWindow.timeline.visit(0);
  await expect.poll(() => first.heading.textContent()).toBe("Page 1");
  expect(await first.start.textContent()).toBe(
    "Navigated to http://shop.test/cart"
  );
  expect(await first.entry(0).title.textContent()).toBe("Click");
  expect(await first.entry(0).target.textContent()).toBe('button "Add item"');
  expect(await first.entry(0).changeRows()).toEqual([
    { element: 'list "Cart"', effect: "appeared" },
  ]);
  expect(await first.entry(1).title.textContent()).toBe(
    "Change without an Interaction"
  );
  expect(await first.entry(1).target.count()).toBe(0);
  expect(await first.entry(1).changeRows()).toEqual([
    { element: 'status "Saved"', effect: "was removed" },
  ]);
  const second = recorderWindow.timeline.visit(1);
  expect(await second.heading.textContent()).toBe("Page 2");
  expect(await second.start.textContent()).toBe(
    "Opened http://shop.test/checkout"
  );
  expect(await recorderWindow.timeline.empty.count()).toBe(0);
});

it("asks for a highlight while an entry's target is hovered, and clears it when left", async () => {
  const { channel, sent, tell } = scriptedChannel();
  mount(channel);
  tell({
    phase: "recording",
    visits: [cart],
    commands: ["stop", "highlight", "clearHighlight"],
  });
  const entry = recorderWindow.timeline.visit(0).entry(0);
  await expect.poll(() => entry.target.count()).toBe(1);

  await entry.hoverTarget();
  await entry.leaveTarget();

  expect(sent).toEqual([
    { type: "highlight", entry: "interaction_1" },
    { type: "clearHighlight" },
  ]);
});

it("asks for no highlight when it does not apply", async () => {
  const { channel, sent, tell } = scriptedChannel();
  mount(channel);
  tell({ phase: "paused", visits: [cart], commands: ["continue"] });
  const entry = recorderWindow.timeline.visit(0).entry(0);
  await expect.poll(() => entry.target.count()).toBe(1);

  await entry.hoverTarget();
  await entry.leaveTarget();

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
  expect(await recorderWindow.controls.assertVisibility.isEnabled()).toBe(true);
  expect(await recorderWindow.controls.picking()).toBe(false);
  await recorderWindow.controls.press("Stop");
  await recorderWindow.controls.assertVisibility.click();
  await recorderWindow.controls.press("Clear");
  await recorderWindow.controls.press("Finish");
  expect(sent).toEqual([
    { type: "stop" },
    { type: "assertVisibility" },
    { type: "clear" },
    { type: "finish" },
  ]);
});

it("shows Assert visibility on while Playwright picks, and leaves it when pressed", async () => {
  const { channel, sent, tell } = scriptedChannel();
  mount(channel);

  tell({
    phase: "recording",
    picking: true,
    commands: ["stop", "leaveAssertVisibility"],
  } as Partial<RecorderState>);

  await expect.poll(() => recorderWindow.controls.picking()).toBe(true);
  await recorderWindow.controls.assertVisibility.click();
  expect(sent).toEqual([{ type: "leaveAssertVisibility" }]);
});

it("offers Continue, Discard and Restore while paused, and dims a discarded entry with what it changed hidden", async () => {
  const { channel, sent, tell } = scriptedChannel();
  mount(channel);
  const discarded = {
    ...cart,
    entries: [
      { ...cart.entries[0]!, discarded: true as const },
      cart.entries[1]!,
    ],
  };

  tell({
    phase: "paused",
    visits: [discarded],
    commands: ["continue", "clear", "finish", "discard", "restore"],
  });

  const visit = recorderWindow.timeline.visit(0);
  await expect.poll(() => visit.entry(0).isDimmed()).toBe(true);
  expect(await visit.entry(0).discardedMark.isVisible()).toBe(true);
  expect(await visit.entry(0).changeRows()).toEqual([]);
  expect(await visit.entry(1).isDimmed()).toBe(false);
  expect(await visit.entry(1).discardedMark.count()).toBe(0);
  expect(await recorderWindow.controls.offered()).toEqual([
    "Continue",
    "Clear",
    "Finish",
  ]);
  await visit.entry(0).restore();
  await visit.entry(1).discard();
  await recorderWindow.controls.press("Continue");
  expect(sent).toEqual([
    { type: "restore", entry: "interaction_1" },
    { type: "discard", entry: "change_1" },
    { type: "continue" },
  ]);
});

it("keeps showing the newest state when an older one comes late", async () => {
  const { channel, tell } = scriptedChannel();
  mount(channel);
  tell({ phase: "recording", commands: ["stop"] }, 5);
  await expect
    .poll(() => recorderWindow.controls.status.textContent())
    .toBe("Recording");

  tell({ phase: "notRecording", commands: ["record"] }, 3);
  // Time for the window to show it, were it to.
  await new Promise((resolve) => setTimeout(resolve, 100));

  expect(await recorderWindow.controls.status.textContent()).toBe("Recording");
  expect(await recorderWindow.controls.offered()).toEqual(["Stop"]);
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

  await recorderWindow.controls.press("Record");
  tell({ phase: "recording", commands: ["stop"] });

  await expect
    .poll(() => recorderWindow.controls.status.textContent())
    .toBe("Recording");
  expect(sent).toEqual([{ type: "record" }]);
});

it("shows itself in the dark scheme when the person's system asks for it", async () => {
  vi.spyOn(globalThis, "matchMedia").mockReturnValue({
    matches: true,
  } as MediaQueryList);
  const { channel } = scriptedChannel();

  mount(channel);

  expect(document.documentElement.classList.contains("dark")).toBe(true);
});

it("shows itself in the light scheme otherwise", async () => {
  vi.spyOn(globalThis, "matchMedia").mockReturnValue({
    matches: false,
  } as MediaQueryList);
  const { channel } = scriptedChannel();

  mount(channel);

  expect(document.documentElement.classList.contains("dark")).toBe(false);
});

it("opens its channel on the server that serves it, at /channel", () => {
  expect(channelUrl({ host: "127.0.0.1:53124" })).toBe(
    "ws://127.0.0.1:53124/channel"
  );
});
