import type { Locator } from "@playwright/test";

/** One step of a run: a locator operation it performed. */
export type RunStep = {
  operation: string;
  /** The locator it acted on. */
  target: string;
  value?: string;
};

/** One run in the Runs timeline. */
export class RunEntry {
  readonly root: Locator;
  /** Expands or collapses the run. */
  readonly toggle: Locator;
  /** The mark of a run made by you from the panel. */
  readonly byYou: Locator;
  readonly error: Locator;
  readonly steps: Locator;

  constructor(root: Locator) {
    this.root = root;
    this.toggle = root.locator("button[aria-expanded]").first();
    this.byYou = root.getByRole("img", { name: "Run by you from the panel" });
    this.error = root.getByRole("note", { name: "Error" });
    this.steps = root
      .getByRole("list", { name: "Steps" })
      .getByRole("listitem");
  }

  /** Running, Succeeded or Failed. */
  async status() {
    return await this.root
      .getByRole("img", { name: /^(Running|Succeeded|Failed)$/ })
      .getAttribute("aria-label");
  }

  /** The element a step acted on; hovering it highlights that element. */
  stepTarget(index: number): Locator {
    return this.steps.nth(index).getByRole("button");
  }

  /** Its steps, in order. */
  async stepList(): Promise<RunStep[]> {
    return await this.steps.evaluateAll((items) =>
      items.map((item) => {
        const [operation = "", value] = [...item.querySelectorAll("span")].map(
          (span) => span.textContent ?? ""
        );
        return {
          operation,
          target: item.querySelector("button")?.textContent ?? "",
          ...(value === undefined ? {} : { value }),
        };
      })
    );
  }
}

/** Runs: the timeline of the runs made from the panel, newest first. */
export class RunsView {
  readonly root: Locator;
  /** Collapses Runs to its header, or expands it. It reads "Runs · 2". */
  readonly header: Locator;
  readonly scope: Locator;
  /** Shows the selection's runs, e.g. "This object". */
  readonly selectionScope: Locator;
  /** Shows every run. */
  readonly allScope: Locator;
  readonly clearButton: Locator;
  readonly timeline: Locator;
  /** The runs shown, newest first. */
  readonly runs: Locator;
  readonly empty: Locator;

  constructor(root: Locator) {
    this.root = root;
    this.header = root.getByRole("button", { name: /^Runs · \d+$/ });
    this.scope = root.getByRole("group", { name: "Runs scope" });
    this.selectionScope = this.scope.getByRole("button").first();
    this.allScope = this.scope.getByRole("button", {
      name: "All",
      exact: true,
    });
    this.clearButton = root.getByRole("button", { name: "Clear", exact: true });
    this.timeline = root.getByRole("list", { name: "Runs timeline" });
    // A run's item is named by its tool; its steps' items are unnamed.
    this.runs = this.timeline.getByRole("listitem", { name: /\S/ });
    this.empty = root.getByText(/^No runs/);
  }

  /** The newest run of one tool. */
  latest(toolName: string): RunEntry {
    return new RunEntry(
      this.timeline
        .getByRole("listitem", { name: toolName, exact: true })
        .first()
    );
  }

  /** A run by its place in the timeline, newest first. */
  run(index: number): RunEntry {
    return new RunEntry(this.runs.nth(index));
  }

  async showAll() {
    await this.allScope.click();
  }

  async showSelection() {
    await this.selectionScope.click();
  }

  async clear() {
    await this.clearButton.click();
  }
}
