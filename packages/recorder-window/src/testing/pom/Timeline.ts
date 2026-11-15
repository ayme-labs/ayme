import { RecorderPart } from "./parts";

/** One row of what an entry changed, read as a person reads it. */
export type WhatChanged = { readonly element: string; readonly effect: string };

/** One row of what an entry changed: the element's chip, and what happened
 * to it. Hovering the chip highlights the element on the page. */
export class ChangeRow extends RecorderPart {
  readonly element = this.root.getByTestId("change-element");
  readonly effect = this.root.getByTestId("change-effect");
}

/** One entry of a Visit: an Interaction, or a change no Interaction made. */
export class Entry extends RecorderPart {
  readonly title = this.root.getByRole("heading");
  /** The Interaction's target; none on a change no Interaction made.
   * Hovering it highlights its element on the page. */
  readonly target = this.root.getByTestId("entry-target");
  readonly whatChangedList = this.root.getByRole("list", {
    name: "What changed",
  });
  /** Leaves the entry out of the recording. It shows while the entry is
   * hovered or has focus, while the recording is paused. */
  readonly discardButton = this.root.getByRole("button", {
    name: "Discard",
    exact: true,
  });
  /** Puts a discarded entry back, while the recording is paused. */
  readonly restoreButton = this.root.getByRole("button", {
    name: "Restore",
    exact: true,
  });

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

  /** Whether the entry shows as left out: its title struck through. */
  async looksDiscarded(): Promise<boolean> {
    const line = await this.title.evaluate(
      (title) => getComputedStyle(title).textDecorationLine
    );
    return line.includes("line-through");
  }

  /** Leaves the entry out: the Discard that shows on it while it is
   * hovered. The entry stays in the timeline, struck through. */
  async discard(): Promise<this> {
    await this.title.hover();
    await this.discardButton.click();
    await this.restoreButton.waitFor();
    return this;
  }
}

/** One Visit: a page of the flow, with its entries. */
export class Visit extends RecorderPart {
  readonly heading = this.root.getByRole("heading", { level: 2 });
  /** How the Visit started, such as "Navigated to http://shop.test/". */
  readonly start = this.root.getByTestId("visit-start");
  readonly entryCards = this.root.getByRole("article");

  async entries(): Promise<Entry[]> {
    return (await this.entryCards.all()).map((card) => new Entry(card));
  }
}

/** The recording as the window lists it: one section per Visit. */
export class Timeline extends RecorderPart {
  readonly visitSections = this.root.getByRole("region");
  /** What the window says while there is no Visit. */
  readonly empty = this.root.getByTestId("timeline-empty");
  /** The lines that join an entry's icon to the next one's. */
  readonly lines = this.root.getByTestId("timeline-line");

  async visits(): Promise<Visit[]> {
    return (await this.visitSections.all()).map(
      (section) => new Visit(section)
    );
  }
}
