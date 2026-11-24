import { ayme } from "@ayme-dev/ayme";
import type { Locator } from "@playwright/test";

import { PanelPart } from "./PanelPart";

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
export class RunEntry extends PanelPart {
  constructor(root: Locator) {
    super(root);
  }

  /** Its card: what it ran, with what, and how it went. */
  @ayme.child
  get card(): Locator {
    // An ancestor comes first in document order: its own card.
    return this.root.locator("[data-run-card]").first();
  }

  /** Expands or collapses the run. */
  @ayme.child
  get toggle(): Locator {
    return this.card.locator("button[aria-expanded]").first();
  }

  /** The mark that it ran before the page last loaded. */
  @ayme.child
  get earlierPage(): Locator {
    return this.card.getByText(/^Earlier page$/);
  }

  /** Its arguments, absent when it had none. */
  @ayme.child
  get arguments(): Locator {
    return this.card.getByRole("figure", { name: "Arguments" });
  }

  /** Shows or hides its result, on a successful run that returned one. */
  @ayme.child
  get resultToggle(): Locator {
    return this.card.getByRole("button", { name: "Result", exact: true });
  }

  /** Its result, as JSON, while shown. */
  @ayme.child
  get result(): Locator {
    return this.card.getByRole("figure", { name: "Result" });
  }

  /** Copies its result. */
  @ayme.child
  get copyResultButton(): Locator {
    return this.card.getByRole("button", { name: "Copy", exact: true });
  }

  @ayme.child
  get error(): Locator {
    return this.card.getByRole("note", { name: "Error" });
  }

  /** The Interactions it performed itself, in order. */
  @ayme.collection
  get interactions(): Locator {
    return this.card
      .getByRole("list", { name: "Interactions" })
      .getByRole("listitem");
  }

  /** The runs it started, nested under it, in the order it started them. */
  @ayme.collection
  get childRuns(): Locator {
    return this.root
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

  /** Whether it flashes, having just been brought into view. */
  async flashing() {
    return (await this.card.getAttribute("data-flashing")) === "true";
  }

  /** Its child runs' tools, in the order it started them. */
  async childTools(): Promise<string[]> {
    return await this.childRuns.evaluateAll((items) =>
      items.map((item) => item.getAttribute("aria-label") ?? "")
    );
  }

  /**
   * Who started it: the icon of one of ayme's own Callers, by its label,
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

  /** Its result as Runs shows it, opened first if it isn't. */
  @ayme.action({
    description:
      "Reads the run's result as Runs shows it, opening it first: JSON, with multi-line strings as their lines.",
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
        const [operation = "", value] = [
          ...item.querySelectorAll(":scope > span"),
        ].map((span) => span.textContent ?? "");
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
export class RunsView extends PanelPart {
  constructor(root: Locator) {
    super(root);
  }

  /** Collapses Runs to its header, or expands it. It reads "Runs · 2". */
  @ayme.child
  get header(): Locator {
    return this.root.getByRole("button", { name: /^Runs · \d+$/ });
  }

  @ayme.child
  get scope(): Locator {
    return this.root.getByRole("group", { name: "Runs scope" });
  }

  /** Shows the selection's runs, e.g. "This object". */
  @ayme.child
  get selectionScope(): Locator {
    return this.scope.getByRole("button").first();
  }

  /** Shows every run. */
  @ayme.child
  get allScope(): Locator {
    return this.scope.getByRole("button", { name: "All", exact: true });
  }

  @ayme.child
  get clearButton(): Locator {
    return this.root.getByRole("button", { name: "Clear", exact: true });
  }

  @ayme.child
  get timeline(): Locator {
    return this.root.getByRole("list", { name: "Runs timeline" });
  }

  /** The runs shown, newest first. */
  @ayme.collection
  get runs(): Locator {
    // The top-level runs: a child run is nested in its parent's item.
    return this.timeline.locator(":scope > li");
  }

  @ayme.child
  get empty(): Locator {
    return this.root.getByText(/^No runs/);
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

  @ayme.action
  async showAll() {
    await this.allScope.click();
  }

  @ayme.action
  async showSelection() {
    await this.selectionScope.click();
  }

  @ayme.action
  async clear() {
    await this.clearButton.click();
  }
}
