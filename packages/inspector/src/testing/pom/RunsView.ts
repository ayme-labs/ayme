import { ayme } from "@ayme-dev/ayme";
import type { Locator } from "@playwright/test";

/** One Interaction of a run: a call it made on the page. */
export type RunInteraction = {
  operation: string;
  /** The member it acted on, or else its locator. */
  target: string;
  value?: string;
};

/**
 * One run in the Runs timeline, top-level or nested under the run that
 * started it. Its own parts are read from its card, so a child run's are
 * never taken for its parent's.
 */
@ayme
export class RunEntry {
  readonly root: Locator;
  /** Its card: what it ran, with what, and how it went. */
  readonly card: Locator;
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
  /** The image it returned, such as a screenshot, with what it shows. */
  readonly image: Locator;
  readonly error: Locator;
  /** The Interactions it performed itself, in order. */
  readonly interactions: Locator;
  /** The runs it started, nested under it, in the order it started them. */
  readonly childRuns: Locator;

  constructor(root: Locator) {
    this.root = root;
    // An ancestor comes first in document order: its own card.
    this.card = root.locator("[data-run-card]").first();
    const card = this.card;
    this.toggle = card.locator("button[aria-expanded]").first();
    this.earlierPage = card.getByText(/^Earlier page$/);
    this.arguments = card.getByRole("figure", { name: "Arguments" });
    this.resultToggle = card.getByRole("button", {
      name: "Result",
      exact: true,
    });
    this.result = card.getByRole("figure", { name: "Result" });
    this.copyResultButton = card.getByRole("button", {
      name: "Copy",
      exact: true,
    });
    this.image = card.getByRole("figure", { name: "Image" });
    this.error = card.getByRole("note", { name: "Error" });
    this.interactions = card
      .getByRole("list", { name: "Interactions" })
      .getByRole("listitem");
    this.childRuns = root
      .getByRole("list", { name: "Child runs" })
      .first()
      .locator(":scope > li");
  }

  /** The newest child run of one tool. */
  child(toolName: string): RunEntry {
    return new RunEntry(
      this.childRuns
        .and(this.root.getByRole("listitem", { name: toolName, exact: true }))
        .last()
    );
  }

  /** Its child runs' tools, in the order it started them. */
  async childTools(): Promise<string[]> {
    return await this.childRuns.evaluateAll((items) =>
      items.map((item) => item.getAttribute("aria-label") ?? "")
    );
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
    return await this.card
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
      .first()
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

  /** What an Interaction acted on; hovering it highlights that element. */
  interactionTarget(index: number): Locator {
    return this.interactions.nth(index).getByRole("button");
  }

  /** Its own Interactions, in order. */
  async interactionList(): Promise<RunInteraction[]> {
    return await this.interactions.evaluateAll((items) =>
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
    // The top-level runs: a child run is nested in its parent's item.
    this.runs = this.timeline.locator(":scope > li");
    this.empty = root.getByText(/^No runs/);
  }

  /** The newest run of one tool. */
  latest(toolName: string): RunEntry {
    return new RunEntry(
      this.runs
        .and(
          this.timeline.getByRole("listitem", { name: toolName, exact: true })
        )
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
