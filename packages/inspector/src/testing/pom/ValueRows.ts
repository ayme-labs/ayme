import type { Locator } from "@playwright/test";

/**
 * A run card's map of labelled values, such as `goal`'s `values`: one row
 * per value, with its label, its value and its type. Rows count from 1.
 */
export class ValueRows {
  readonly root: Locator;
  /** The schema's description of the map, shown above the rows. */
  readonly description: Locator;
  readonly addButton: Locator;
  /** How many values are set, against the most the map takes, e.g. "2 / 254". */
  readonly count: Locator;
  private readonly path: string;

  constructor(card: Locator, path: string) {
    this.path = path;
    this.root = card.getByRole("group", { name: path, exact: true });
    this.description = card.getByRole("note", { name: `${path} description` });
    this.addButton = card.getByRole("button", {
      name: `Add to ${path}`,
      exact: true,
    });
    this.count = card.getByRole("status", { name: `${path} count` });
  }

  label(row: number): Locator {
    return this.root.getByRole("textbox", {
      name: `${this.path} label ${row}`,
      exact: true,
    });
  }

  value(row: number): Locator {
    return this.root.getByRole("textbox", {
      name: `${this.path} value ${row}`,
      exact: true,
    });
  }

  /**
   * The row's type, inside its value: "abc" or "123", pressed once fixed.
   * A click fixes a guessed type to the other one, or switches a fixed one.
   */
  type(row: number): Locator {
    return this.root.getByRole("button", {
      name: `${this.path} type ${row}`,
      exact: true,
    });
  }

  /**
   * What the row is sent as: "auto · text" or "auto · number" while the type
   * is guessed from the value, "text" or "number" once fixed.
   */
  async typeState(row: number): Promise<string> {
    const type = this.type(row);
    const shown = (await type.textContent()) === "123" ? "number" : "text";
    return (await type.getAttribute("aria-pressed")) === "true"
      ? shown
      : `auto · ${shown}`;
  }

  /** What's wrong with the row, when anything is. */
  problem(row: number): Locator {
    return this.root.getByRole("status", {
      name: `${this.path} problem ${row}`,
      exact: true,
    });
  }

  removeButton(row: number): Locator {
    return this.root.getByRole("button", {
      name: `Remove ${this.path} ${row}`,
      exact: true,
    });
  }

  rows(): Locator {
    return this.root.getByRole("textbox", {
      name: new RegExp(`^${this.path} label \\d+$`),
    });
  }

  /**
   * Adds one row per entry. A string that reads as a number is fixed to
   * text, so every value keeps the type it is given.
   */
  async fill(entries: Readonly<Record<string, string | number>>) {
    for (const [label, value] of Object.entries(entries)) {
      await this.addButton.click();
      const row = await this.rows().count();
      await this.label(row).fill(label);
      await this.value(row).fill(String(value));
      const wanted = typeof value === "number" ? "number" : "text";
      if (!(await this.typeState(row)).endsWith(wanted))
        await this.type(row).click();
    }
  }
}
