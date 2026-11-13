import type { Locator } from "@playwright/test";

/** One row of what an entry changed: the element and what happened to it. */
export type ChangeRow = {
  readonly element: string;
  readonly effect: "appeared" | "was removed" | "changed";
};

/** One entry of a Visit: an Interaction, or a change no Interaction made. */
export class Entry {
  readonly title: Locator;
  /** The Interaction's target; none on a change no Interaction made. */
  readonly target: Locator;
  readonly changes: Locator;

  constructor(readonly root: Locator) {
    this.title = root.getByRole("heading");
    this.target = root.getByTestId("entry-target");
    this.changes = root.getByRole("list", { name: "What changed" });
  }

  /** The rows of what it changed, in the order shown. */
  async changeRows(): Promise<ChangeRow[]> {
    const rows = this.changes.getByRole("listitem");
    const read: ChangeRow[] = [];
    for (let index = 0; index < (await rows.count()); index += 1) {
      const row = rows.nth(index);
      read.push({
        element: (await row.getByTestId("change-element").innerText()).trim(),
        effect: (
          await row.getByTestId("change-effect").innerText()
        ).trim() as ChangeRow["effect"],
      });
    }
    return read;
  }
}

/** One Visit: a page of the flow, with its entries. */
export class Visit {
  readonly heading: Locator;
  /** How the Visit started, such as "Navigated to http://shop.test/". */
  readonly start: Locator;
  readonly entries: Locator;

  constructor(readonly root: Locator) {
    this.heading = root.getByRole("heading", { level: 2 });
    this.start = root.getByTestId("visit-start");
    this.entries = root.getByRole("article");
  }

  entry(index: number): Entry {
    return new Entry(this.entries.nth(index));
  }
}

/** The recording as the window lists it: one section per Visit. */
export class Timeline {
  readonly visits: Locator;
  /** What the window says while there is no Visit. */
  readonly empty: Locator;

  constructor(readonly root: Locator) {
    this.visits = root.getByRole("region");
    this.empty = root.getByTestId("timeline-empty");
  }

  visit(index: number): Visit {
    return new Visit(this.visits.nth(index));
  }
}
