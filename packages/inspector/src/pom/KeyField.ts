import type { Locator } from "@playwright/test";

/**
 * A run card's key field: focusing it records the key or combo pressed;
 * Esc switches it to searching key names.
 */
export class KeyField {
  /** Shows the key, e.g. `ControlOrMeta+C`. */
  readonly input: Locator;
  /** Shows the mode and switches it. */
  readonly modeButton: Locator;
  /** What to press while recording, or what's wrong with the key. */
  readonly help: Locator;
  /** Replaces the key with the one it names, e.g. "Use Shift+Tab". */
  readonly fixButton: Locator;
  /** While searching: the key names that match. */
  readonly options: Locator;

  constructor(card: Locator, path: string) {
    this.input = card.getByRole("combobox", { name: path, exact: true });
    this.modeButton = card.getByRole("button", {
      name: /^(Search key names|Record a key press) instead$/,
    });
    this.help = card.getByRole("status", { name: `${path} help` });
    this.fixButton = card.getByRole("button", { name: /^Use / });
    this.options = card
      .getByRole("listbox", { name: "Key names" })
      .getByRole("option");
  }

  /** Whether the field records a key press or searches key names. */
  async mode(): Promise<"record" | "search"> {
    return (await this.modeButton.getAttribute("aria-label")) ===
      "Search key names instead"
      ? "record"
      : "search";
  }

  /** Records a key press, e.g. "F5" or "Control+c", as Playwright names it. */
  async record(key: string) {
    await this.input.focus();
    await this.input.press(key);
  }

  /** Switches to searching and types a key name, e.g. "arr" or "shift+tab". */
  async search(text: string) {
    await this.input.focus();
    if ((await this.mode()) === "record") await this.input.press("Escape");
    await this.input.fill(text);
  }
}
