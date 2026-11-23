import { ayme } from "@ayme-dev/ayme";
import type { Locator } from "@playwright/test";

import { RecorderPart } from "./parts";

/** One row of what an entry changed, read as a person reads it. */
export type WhatChanged = { readonly element: string; readonly effect: string };

/** One row of what an entry changed: the element's chip, and what happened
 * to it. Hovering the chip highlights the element on the page. */
export class ChangeRow extends RecorderPart {
  @ayme.child
  readonly element: Locator;
  @ayme.child
  readonly effect: Locator;

  constructor(root: Locator) {
    super(root);
    this.element = root.getByTestId("change-element");
    this.effect = root.getByTestId("change-effect");
  }
}

/** How an entry shows, apart from its words (`Entry.look`). */
export type EntryLook = {
  readonly opacity: string;
  readonly fontStyle: string;
  readonly background: string;
  readonly border: string;
  readonly busy: string | null;
  readonly live: string | null;
};

/** One entry of a Visit: an Interaction, or a change no Interaction made. */
export class Entry extends RecorderPart {
  @ayme.child
  readonly title: Locator;
  /** The Interaction's target; none on a change no Interaction made.
   * Hovering it highlights its element on the page. */
  @ayme.child
  readonly target: Locator;
  @ayme.child
  readonly whatChangedList: Locator;
  /** Leaves the entry out of the recording. It shows while the entry is
   * hovered or has focus, while the recording is paused. */
  @ayme.child
  readonly discardButton: Locator;
  /** Puts a discarded entry back, while the recording is paused. */
  @ayme.child
  readonly restoreButton: Locator;

  constructor(root: Locator) {
    super(root);
    this.title = root.getByRole("heading");
    this.target = root.getByTestId("entry-target");
    this.whatChangedList = root.getByRole("list", { name: "What changed" });
    this.discardButton = root.getByRole("button", {
      name: "Discard",
      exact: true,
    });
    this.restoreButton = root.getByRole("button", {
      name: "Restore",
      exact: true,
    });
  }

  /** The rows of what it changed, in the order shown. */
  async changes(): Promise<ChangeRow[]> {
    const rows = await this.whatChangedList.getByRole("listitem").all();
    return rows.map((row) => new ChangeRow(row));
  }

  /** What it changed, as a person reads each row. */
  async whatChanged(): Promise<WhatChanged[]> {
    const read: WhatChanged[] = [];
    for (const row of await this.changes())
      read.push({
        element: (await row.element.innerText()).trim(),
        effect: (await row.effect.innerText()).trim(),
      });
    return read;
  }

  /** How the entry shows, apart from its words: whatever could mark one
   * entry out from another, as a state of its own. */
  async look(): Promise<EntryLook> {
    return this.root.evaluate((entry) => {
      const shown = getComputedStyle(entry);
      return {
        opacity: shown.opacity,
        fontStyle: shown.fontStyle,
        background: shown.backgroundColor,
        border: shown.borderColor,
        busy: entry.getAttribute("aria-busy"),
        live: entry.getAttribute("aria-live"),
      };
    });
  }

  /** Whether the entry shows as left out: its title struck through. */
  async looksDiscarded(): Promise<boolean> {
    const line = await this.title.evaluate(
      (title) => getComputedStyle(title).textDecorationLine
    );
    return line.includes("line-through");
  }

  /** Leaves the entry out: the Discard that shows on it while it is
   * hovered. The entry stays in the timeline, struck through. */
  @ayme.action({
    description:
      "Leaves the entry out of the recording, while it is paused: it stays in place, struck through.",
  })
  async discard(): Promise<this> {
    await this.title.hover();
    await this.discardButton.click();
    await this.restoreButton.waitFor();
    return this;
  }
}

/** One Visit: a page of the flow, with its entries. */
export class Visit extends RecorderPart {
  @ayme.child
  readonly heading: Locator;
  /** How the Visit started, such as "Navigated to http://shop.test/". */
  @ayme.child
  readonly start: Locator;
  @ayme.collection
  readonly entryCards: Locator;
  /** The entries of Interactions, the steps, without the changes no
   * Interaction made. */
  @ayme.collection
  readonly stepCards: Locator;

  constructor(root: Locator) {
    super(root);
    this.heading = root.getByRole("heading", { level: 2 });
    this.start = root.getByTestId("visit-start");
    this.entryCards = root.getByRole("article");
    this.stepCards = this.entryCards.and(
      root.locator('[data-kind="interaction"]')
    );
  }

  async entries(): Promise<Entry[]> {
    return (await this.entryCards.all()).map((card) => new Entry(card));
  }

  /** The steps, in the order shown. */
  async steps(): Promise<Entry[]> {
    return (await this.stepCards.all()).map((card) => new Entry(card));
  }
}

/** The recording as the window lists it: one section per Visit. */
export class Timeline extends RecorderPart {
  @ayme.collection
  readonly visitSections: Locator;
  /** What the window says while there is no Visit. */
  @ayme.child
  readonly empty: Locator;
  /** The lines that join an entry's icon to the next one's. */
  @ayme.collection
  readonly lines: Locator;

  constructor(root: Locator) {
    super(root);
    this.visitSections = root.getByRole("region");
    this.empty = root.getByTestId("timeline-empty");
    this.lines = root.getByTestId("timeline-line");
  }

  async visits(): Promise<Visit[]> {
    return (await this.visitSections.all()).map(
      (section) => new Visit(section)
    );
  }
}
