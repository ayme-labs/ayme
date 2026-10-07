import { ayme } from "@ayme-dev/ayme";
import type { Locator } from "@playwright/test";

/** One step of a run: a locator operation it performed. */
export type RunStep = {
  operation: string;
  /** The locator it acted on. */
  target: string;
  value?: string;
};

/** One run in the Runs timeline. */
@ayme
export class RunEntry {
  readonly root: Locator;
  /** Expands or collapses the run. */
  readonly toggle: Locator;
  /** The mark that it ran before the page last loaded. */
  readonly earlierPage: Locator;
  /** Its arguments, absent when it had none. */
  readonly arguments: Locator;
  /** Shows or hides its result, on a successful run that returned one. */
  readonly resultToggle: Locator;
  /** Its result, as JSON, while shown. */
  readonly result: Locator;
  /** Copies its result. */
  readonly copyResultButton: Locator;
  readonly error: Locator;
  readonly steps: Locator;

  constructor(root: Locator) {
    this.root = root;
    this.toggle = root.locator("button[aria-expanded]").first();
    this.earlierPage = root.getByText(/^Earlier page$/);
    this.arguments = root.getByRole("figure", { name: "Arguments" });
    this.resultToggle = root.getByRole("button", {
      name: "Result",
      exact: true,
    });
    this.result = root.getByRole("figure", { name: "Result" });
    this.copyResultButton = root.getByRole("button", {
      name: "Copy",
      exact: true,
    });
    this.error = root.getByRole("note", { name: "Error" });
    this.steps = root
      .getByRole("list", { name: "Steps" })
      .getByRole("listitem");
  }

  /**
   * Who started it: the icon of one of Ayme's own Callers, by its label,
   * e.g. "Run by you from the Inspector", or another Caller's name as text.
   */
  @ayme.action({
    description:
      "Reads who started the run: a built-in Caller's icon label, or another Caller's name as text.",
  })
  async caller(): Promise<{ icon: string } | { text: string }> {
    return await this.root
      .getByTitle(/^Run by /)
      .first()
      .evaluate((mark) =>
        mark.getAttribute("role") === "img"
          ? { icon: mark.getAttribute("aria-label") ?? "" }
          : { text: mark.textContent ?? "" }
      );
  }

  /** Running, Succeeded or Failed. */
  @ayme.action({
    description: "Reads the run's status: Running, Succeeded or Failed.",
  })
  async status() {
    return await this.root
      .getByRole("img", { name: /^(Running|Succeeded|Failed)$/ })
      .getAttribute("aria-label");
  }

  /** Its result as JSON, shown first if it isn't. */
  @ayme.action({
    description: "Reads the run's result as JSON, shown first if it is not.",
  })
  async resultText() {
    if ((await this.resultToggle.getAttribute("aria-expanded")) === "false")
      await this.resultToggle.click();
    return await this.result.textContent();
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

/** Runs: the timeline of the page's Runs, by any Caller, newest first. */
@ayme
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

  @ayme.action({ description: "Shows every run." })
  async showAll() {
    await this.allScope.click();
  }

  @ayme.action({ description: "Shows the selection's runs." })
  async showSelection() {
    await this.selectionScope.click();
  }

  @ayme.action({ description: "Clears the runs." })
  async clear() {
    await this.clearButton.click();
  }
}
