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
import { RecorderWindow, type Entry } from "../testing";
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
        state: {
          visits: [],
          commands: [],
          warnings: [],
          url: null,
          ...state,
        },
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
        // Only a change of the scheme is told, as a browser tells it.
        addEventListener: (type: string, listener: () => void) =>
          type === "change" && listeners.add(listener),
        removeEventListener: (type: string, listener: () => void) =>
          type === "change" && listeners.delete(listener),
      }) as unknown as MediaQueryList
  );
  return {
    set(next: boolean) {
      matches = next;
      for (const listener of listeners) listener();
    },
    /** Whether anything still follows the scheme. */
    followed: () => listeners.size > 0,
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
  // A target the engine gives no words for reads "element", never its raw
  // selector, which shows on hover as the last fallback.
  expect(await assertion!.target.textContent()).toBe("element");
  expect(await assertion!.target.getAttribute("title")).toBe(
    '[data-test="title"]'
  );
  expect(await recorderWindow.timeline.empty.count()).toBe(0);
});

it("says a Visit that a new page started was opened", async () => {
  const { channel, tell } = scriptedChannel();
  mount(channel);
  const opened: RecordedVisit = {
    visitId: "visit_3",
    url: "http://shop.test/help",
    cause: "openPage",
    entries: [],
  };

  tell({ phase: "recording", visits: [login, opened], commands: ["stop"] });

  await expect.poll(async () => (await visits()).length).toBe(2);
  const [, second] = await visits();
  expect(await second!.start.textContent()).toBe(
    "Opened http://shop.test/help"
  );
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

it("highlights the element of a chip of any Visit while it is hovered, and clears it when left", async () => {
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
  const [click] = await (await visits())[1]!.entries();
  const [, second] = await click!.changes();

  await click!.target.hover();
  await second!.element.hover();
  // An earlier Visit's: the engine looks for it on the page as it is now.
  await fill!.target.hover();
  await row!.element.hover();
  await click!.title.hover();

  expect(sent).toEqual([
    { type: "highlight", entry: entryId("interaction_2") },
    { type: "clearHighlight" },
    { type: "highlight", entry: entryId("interaction_2"), row: 1 },
    { type: "clearHighlight" },
    { type: "highlight", entry: entryId("interaction_1") },
    { type: "clearHighlight" },
    { type: "highlight", entry: entryId("interaction_1"), row: 0 },
    { type: "clearHighlight" },
  ]);
});

it("asks for no highlight when it does not apply", async () => {
  const { channel, sent, tell } = scriptedChannel();
  mount(channel);
  tell({ phase: "paused", visits: [login, inventory], commands: ["continue"] });
  await expect.poll(async () => (await visits()).length).toBe(2);
  const [click] = await (await visits())[1]!.entries();
  const [row] = await click!.changes();

  await click!.target.hover();
  await row!.element.hover();
  await click!.title.hover();

  expect(sent).toEqual([]);
});

/** A list page after a click on "Closed": three items of "Issues" went out
 * and one came in, two came into another list of the same name, and a
 * button's cursor alone changed. */
const issues = { ref: "e2", name: "Issues" };
const pinned = { ref: "e6", name: "Issues" };
const listed: RecordedVisit = {
  visitId: "visit_1",
  url: "http://shop.test/issues",
  cause: "initial",
  entries: [
    {
      kind: "interaction",
      id: entryId("interaction_1"),
      timestamp: 10,
      interaction: {
        id: entryId("interaction_1"),
        type: "click",
        targetRef: "e9",
        targetSelector: 'internal:role=tab[name="Closed"s]',
      },
      targetElement: 'tab "Closed"',
      changes: [
        {
          kind: "changed",
          element: 'button "New issue"',
          changed: [{ property: "cursor", to: "pointer" }],
        },
        {
          kind: "removed",
          element: 'listitem "Open one"',
          role: "listitem",
          parent: issues,
        },
        {
          kind: "changed",
          element: 'tab "Closed"',
          changed: [{ property: "selected", to: "true" }],
        },
        {
          kind: "removed",
          element: 'listitem "Open two"',
          role: "listitem",
          parent: issues,
        },
        {
          kind: "added",
          element: 'listitem "Closed one"',
          role: "listitem",
          parent: issues,
        },
        {
          kind: "removed",
          element: 'listitem "Open three"',
          role: "listitem",
          parent: issues,
        },
        {
          kind: "added",
          element: 'listitem "Pinned one"',
          role: "listitem",
          parent: pinned,
        },
        {
          kind: "added",
          element: 'listitem "Pinned two"',
          role: "listitem",
          parent: pinned,
        },
      ],
    },
    {
      kind: "change",
      id: entryId("change_1"),
      timestamp: 20,
      changes: [
        {
          kind: "changed",
          element: 'link "Help"',
          changed: [{ property: "cursor" }],
        },
      ],
    },
  ],
};

it("folds three or more elements of one role that went in or out of one named parent into one collapsed row, which expands to each of them, and keeps two such elements, and another parent's of the same name, as rows of their own", async () => {
  const { channel, tell } = scriptedChannel();
  mount(channel);
  tell({ phase: "recording", visits: [listed], commands: ["stop"] });
  await expect.poll(async () => (await visits()).length).toBe(1);
  const [click] = await (await visits())[0]!.entries();

  expect(await click!.whatChanged()).toEqual([
    {
      element: "4 listitems",
      effect: "3 removed from, 1 appeared in “Issues”",
    },
    { element: "tab “Closed”", effect: "became selected" },
    { element: "listitem “Pinned one”", effect: "appeared" },
    { element: "listitem “Pinned two”", effect: "appeared" },
  ]);
  const [folded] = await click!.changes();
  expect(await folded!.isExpanded()).toBe(false);
  expect(await folded!.foldedList.count()).toBe(0);

  await folded!.expand();

  expect(await folded!.isExpanded()).toBe(true);
  expect(await folded!.whatFolded()).toEqual([
    { element: "listitem “Open one”", effect: "was removed" },
    { element: "listitem “Open two”", effect: "was removed" },
    { element: "listitem “Closed one”", effect: "appeared" },
    { element: "listitem “Open three”", effect: "was removed" },
  ]);
});

it("highlights the element of each row an expanded row folds while it is hovered, by its place among the entry's rows", async () => {
  const { channel, sent, tell } = scriptedChannel();
  mount(channel);
  tell({
    phase: "recording",
    visits: [listed],
    commands: ["stop", "highlight", "clearHighlight"],
  });
  await expect.poll(async () => (await visits()).length).toBe(1);
  const [click] = await (await visits())[0]!.entries();
  const [folded] = await click!.changes();

  // The row that folds them asks nothing of its own.
  await folded!.element.hover();
  await folded!.expand();
  const [, second, third] = await folded!.folded();
  await second!.element.hover();
  await third!.element.hover();
  await click!.title.hover();

  expect(sent).toEqual([
    { type: "highlight", entry: entryId("interaction_1"), row: 3 },
    { type: "clearHighlight" },
    { type: "highlight", entry: entryId("interaction_1"), row: 4 },
    { type: "clearHighlight" },
  ]);
});

it("lists no row for an element whose only change is the cursor, and does not show a change no Interaction made that is left with no rows", async () => {
  const { channel, tell } = scriptedChannel();
  mount(channel);
  tell({ phase: "recording", visits: [listed], commands: ["stop"] });
  await expect.poll(async () => (await visits()).length).toBe(1);
  const [visit] = await visits();

  const entries = await visit!.entries();
  expect(entries).toHaveLength(1);
  const elements = (await entries[0]!.whatChanged()).map(
    ({ element }) => element
  );
  expect(elements).not.toContain("button “New issue”");
  // Its icon joins nothing below it.
  expect(await recorderWindow.timeline.lines.count()).toBe(1);
});

it("shows a chip that can highlight its element with a border and a crosshair, and one that cannot as before", async () => {
  const { channel, tell } = scriptedChannel();
  mount(channel);
  /** How a chip shows that it can be hovered: its border always takes
   * its width, and shows only then. */
  const look = (chip: Entry["target"]) =>
    chip.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        cursor: style.cursor,
        border: style.borderTopWidth,
        shown: style.borderTopColor !== "rgba(0, 0, 0, 0)",
      };
    });
  tell({
    phase: "recording",
    visits: [login, inventory],
    commands: ["stop", "highlight", "clearHighlight"],
  });
  await expect.poll(async () => (await visits()).length).toBe(2);
  const [click] = await (await visits())[1]!.entries();
  const [row] = await click!.changes();

  expect(await look(click!.target)).toEqual({
    cursor: "crosshair",
    border: "1px",
    shown: true,
  });
  expect(await look(row!.element)).toEqual({
    cursor: "crosshair",
    border: "1px",
    shown: true,
  });

  tell({ phase: "paused", visits: [login, inventory], commands: ["continue"] });
  await expect
    .poll(() => look(click!.target))
    .toEqual({
      cursor: "auto",
      border: "1px",
      shown: false,
    });
  expect(await look(row!.element)).toEqual({
    cursor: "auto",
    border: "1px",
    shown: false,
  });
});

it("shows a chip whose highlight finds no element on the page without a border or a crosshair, and with them again once one is found, at the one size throughout", async () => {
  let result: CommandResult = "notFound";
  const { channel, tell } = scriptedChannel(async () => result);
  mount(channel);
  const look = (chip: Entry["target"]) =>
    chip.evaluate((element) => {
      const style = getComputedStyle(element);
      const { width, height } = element.getBoundingClientRect();
      return {
        cursor: style.cursor,
        shown: style.borderTopColor !== "rgba(0, 0, 0, 0)",
        size: { width, height },
      };
    });
  tell({
    phase: "recording",
    visits: [login, inventory],
    commands: ["stop", "highlight", "clearHighlight"],
  });
  await expect.poll(async () => (await visits()).length).toBe(2);
  const [click] = await (await visits())[1]!.entries();
  const { size } = await look(click!.target);

  await click!.target.hover();
  await expect
    .poll(() => look(click!.target))
    .toEqual({ cursor: "auto", shown: false, size });

  result = "applied";
  await (await visits())[0]!.heading.hover();
  await click!.target.hover();
  await expect
    .poll(() => look(click!.target))
    .toEqual({ cursor: "crosshair", shown: true, size });
});

it("leaves a chip as the last answer left it when a hover is answered 'ignored', as one a later highlight replaced", async () => {
  let result: CommandResult = "applied";
  const { channel, tell } = scriptedChannel(async () => result);
  mount(channel);
  tell({
    phase: "recording",
    visits: [login, inventory],
    commands: ["stop", "highlight", "clearHighlight"],
  });
  await expect.poll(async () => (await visits()).length).toBe(2);
  const [click] = await (await visits())[1]!.entries();
  const highlights = () => click!.target.getAttribute("data-highlights");
  await click!.target.hover();
  await expect.poll(highlights).toBe("true");

  result = "ignored";
  await (await visits())[0]!.heading.hover();
  await click!.target.hover();
  await new Promise((resolve) => setTimeout(resolve, 100));

  expect(await highlights()).toBe("true");
});

it("gives a chip no keyboard focus, and no background of its own when hovered", async () => {
  const { channel, tell } = scriptedChannel();
  mount(channel);
  tell({
    phase: "recording",
    visits: [login, inventory],
    commands: ["stop", "highlight", "clearHighlight"],
  });
  await expect.poll(async () => (await visits()).length).toBe(2);
  const [click] = await (await visits())[1]!.entries();
  const background = () =>
    click!.target.evaluate(
      (element) => getComputedStyle(element).backgroundColor
    );
  const resting = await background();

  expect(await click!.target.evaluate((element) => element.tabIndex)).toBe(-1);
  await click!.target.hover();
  expect(await background()).toBe(resting);
});

it("shows a fill still being typed as any other step: nothing marks it", async () => {
  const { channel, tell } = scriptedChannel();
  mount(channel);
  const fillEntry = login.entries[0] as Extract<
    RecordedVisit["entries"][number],
    { kind: "interaction" }
  >;
  const typing = {
    ...login,
    entries: [
      {
        ...fillEntry,
        interaction: { ...fillEntry.interaction, text: "secret" },
        // Shown before the page is read again: no changes yet.
        changes: null,
      },
    ],
  } as RecordedVisit;
  tell({ phase: "recording", visits: [typing], commands: ["stop"] });
  await expect.poll(async () => (await visits()).length).toBe(1);
  const [live] = await (await visits())[0]!.entries();
  const shownLive = {
    title: await live!.title.textContent(),
    target: await live!.target.textContent(),
    look: await live!.look(),
  };

  // The same fill once it is final, with what it changed.
  tell({
    phase: "recording",
    visits: [{ ...login, entries: [fillEntry] }],
    commands: ["stop"],
  });
  await expect
    .poll(async () =>
      (await (await visits())[0]!.entries())[0]!.title.textContent()
    )
    .toBe("Fill 'secret_sauce'");
  const [final] = await (await visits())[0]!.entries();

  expect(shownLive).toEqual({
    title: "Fill 'secret'",
    target: "textbox “Password”",
    look: await final!.look(),
  });
  expect(shownLive.look).toMatchObject({ busy: null, live: null });
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

it("stops following the system's scheme once it is taken out", async () => {
  const system = scheme(false);
  const { channel, tell } = scriptedChannel();
  mount(channel);
  tell({ phase: "notRecording", commands: ["record"] });
  await expect.poll(() => recorderWindow.controls.theme()).toBe("System");
  expect(system.followed()).toBe(true);

  for (const unmount of unmounts.splice(0)) unmount();

  expect(system.followed()).toBe(false);
});

it("follows the system's scheme when the browser lets it read no stored theme", async () => {
  const system = scheme(true);
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("Storage is blocked.");
  });
  const { channel, tell } = scriptedChannel();
  mount(channel);
  tell({ phase: "notRecording", commands: ["record"] });

  await expect.poll(() => recorderWindow.controls.theme()).toBe("System");
  expect(isDark()).toBe(true);
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

it("names the page that is open in its title, recording or not", async () => {
  const { channel, tell } = scriptedChannel();
  mount(channel);
  tell({ phase: "notRecording", commands: [] });
  await expect.poll(() => document.title).toBe("ayme Recorder");

  // Before Record: no Visit yet, and the page is named all the same.
  tell({
    phase: "notRecording",
    commands: ["record"],
    url: "http://shop.test/login",
  });
  await expect
    .poll(() => document.title)
    .toBe("ayme Recorder - http://shop.test/login");
  // While paused, the page goes on to another that no Visit records.
  tell({
    phase: "paused",
    visits: [login],
    commands: ["continue"],
    url: "http://shop.test/inventory",
  });
  await expect
    .poll(() => document.title)
    .toBe("ayme Recorder - http://shop.test/inventory");
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
