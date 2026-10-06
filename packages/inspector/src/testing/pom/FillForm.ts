import { ayme } from "@ayme-dev/ayme";
import type { Locator } from "@playwright/test";

/**
 * `fill_form`'s form in a run card: every field on the page as a row, by
 * its name. The rows changed are filled, numbered in fill order.
 */
@ayme
export class FillForm {
  /** The rows, in fill order. */
  readonly rows: Locator;
  /** How many rows are changed, e.g. "2 changed". */
  readonly changedCount: Locator;
  readonly undoAllButton: Locator;

  constructor(card: Locator) {
    this.rows = card
      .getByRole("list", { name: "Form fields" })
      .getByRole("listitem");
    this.changedCount = card.getByRole("status", { name: "Changed fields" });
    this.undoAllButton = card.getByRole("button", { name: "Undo all" });
  }

  /** A field's row, by its name. */
  row(name: string): Locator {
    return this.rows.filter({
      has: this.rows.page().getByLabel(name, { exact: true }),
    });
  }

  /** A field's control, by its name: a radio group's is the group. */
  control(name: string): Locator {
    return this.rows.getByLabel(name, { exact: true });
  }

  /** The rows' names, in fill order. */
  @ayme.action({ description: "Lists the rows' names, in fill order." })
  async names(): Promise<string[]> {
    return Promise.all(
      (await this.rows.all()).map(
        async (row) => (await row.locator("label").first().textContent()) ?? ""
      )
    );
  }

  /** The changed rows' names, in fill order. */
  @ayme.action({ description: "Lists the changed rows' names, in fill order." })
  async changed(): Promise<string[]> {
    const changed = this.rows.filter({
      has: this.rows.page().getByLabel("Fill order", { exact: true }),
    });
    return Promise.all(
      (await changed.all()).map(
        async (row) => (await row.locator("label").first().textContent()) ?? ""
      )
    );
  }

  /** A row's fill-order number; none on a row that isn't changed. */
  fillOrder(name: string): Locator {
    return this.row(name).getByLabel("Fill order", { exact: true });
  }

  /** Whether the last run couldn't fill the field. */
  @ayme.action({
    description: "Whether the last run could not fill the field.",
  })
  async failed(name: string): Promise<boolean> {
    return (await this.row(name).getAttribute("data-failed")) === "true";
  }

  /**
   * Sets a field: text for a textbox, a checked state for a checkbox, an
   * option's label for a combobox or a radio group, a number for a slider.
   */
  async set(name: string, value: string | boolean) {
    const control = this.control(name);
    const kind = await control.evaluate((element) =>
      element.getAttribute("role") === "radiogroup"
        ? "radiogroup"
        : element instanceof HTMLInputElement
          ? element.type
          : element.tagName.toLowerCase()
    );
    if (kind === "radiogroup")
      await control
        .getByRole("radio", { name: String(value), exact: true })
        .click();
    else if (typeof value === "boolean") await control.setChecked(value);
    else if (kind === "select") await control.selectOption({ label: value });
    else await control.fill(value);
  }

  /** Undoes the change to one field. */
  @ayme.action({ description: "Undoes the change to one field." })
  async undo(name: string) {
    await this.row(name)
      .getByRole("button", { name: `Undo the change to ${name}` })
      .click();
  }

  /** A row's handle: drag it, or press the arrow keys on it, to move the row. */
  moveButton(name: string): Locator {
    return this.row(name).getByRole("button", { name: `Move ${name}` });
  }

  /** Drags a row onto another, which moves it to that row's place. */
  @ayme.action({
    description:
      "Drags a row onto another, which moves it to that row's place.",
  })
  async drag(name: string, onto: string) {
    await this.moveButton(name).dragTo(this.row(onto));
  }
}
