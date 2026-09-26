import type { Locator } from "@playwright/test";

/** The Runs view: the runs made from the panel, newest first. */
export class RunsView {
  readonly root: Locator;
  readonly runList: Locator;
  readonly runs: Locator;
  readonly clearButton: Locator;
  readonly trace: Locator;

  constructor(root: Locator) {
    this.root = root;
    this.runList = root.getByRole("region", { name: "Recent executions" });
    this.runs = this.runList.getByRole("listitem");
    this.clearButton = this.runList.getByRole("button", { name: "Clear" });
    this.trace = root.getByRole("region", { name: "Latest browser trace" });
  }

  /** The runs of one tool. */
  runsOf(toolName: string): Locator {
    return this.runs.filter({ hasText: toolName });
  }

  /** A run's status: running, succeeded or failed. */
  status(run: Locator): Locator {
    return run.locator("[data-run-status]");
  }

  async clear() {
    await this.clearButton.click();
  }
}
