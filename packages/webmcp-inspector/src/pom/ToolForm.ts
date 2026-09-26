import type { Locator } from "@playwright/test";

/** A value for one argument, as a person would enter it. */
export type ArgumentValue = string | number | boolean | Record<string, unknown>;

/** The form that runs one tool from the panel. */
export class ToolForm {
  readonly root: Locator;
  readonly runButton: Locator;
  /** The reason the arguments were rejected. */
  readonly error: Locator;
  /** The last run's status and its result or error. */
  readonly lastResult: Locator;

  constructor(root: Locator) {
    this.root = root;
    this.runButton = root.getByRole("button", { name: "Invoke" });
    this.error = root.getByRole("alert");
    this.lastResult = root.locator("[data-last-run]");
  }

  /** The field for one argument. */
  field(name: string): Locator {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return this.root.getByLabel(new RegExp(`^${escaped}( \\(optional\\))?$`));
  }

  async fill(args: Readonly<Record<string, ArgumentValue>>) {
    for (const [name, value] of Object.entries(args)) {
      const field = this.field(name);
      const kind = await field.evaluate((element) =>
        element instanceof HTMLSelectElement
          ? "select"
          : (element as HTMLInputElement).type
      );
      if (typeof value === "boolean") await field.setChecked(value);
      else if (kind === "select")
        await field.selectOption({ label: String(value) });
      else if (kind === "number") {
        // playwright-lite's fill assigns a number input's value directly,
        // which React's controlled input never sees; typing reaches it.
        await field.fill("");
        await field.pressSequentially(String(value));
      } else
        await field.fill(
          typeof value === "object" ? JSON.stringify(value) : String(value)
        );
    }
  }

  /** Fills the given arguments and runs the tool. */
  async run(args: Readonly<Record<string, ArgumentValue>> = {}) {
    await this.fill(args);
    await this.runButton.click();
  }
}
