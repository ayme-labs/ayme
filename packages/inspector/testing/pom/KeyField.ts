import { ayme } from "@ayme-dev/ayme";
import type { Locator } from "@playwright/test";

/**
 * A run card's key field: focusing it records the key or combo pressed;
 * Esc switches it to searching key names.
 */
@ayme
export class KeyField {
  constructor(
    private readonly card: Locator,
    private readonly path: string
  ) {}

  /** Shows the key, e.g. `ControlOrMeta+C`. */
  @ayme.child
  get input(): Locator {
    return this.card.getByRole("combobox", { name: this.path, exact: true });
  }

  /** Shows the mode and switches it. */
  @ayme.child
  get modeButton(): Locator {
    return this.card.getByRole("button", {
      name: /^(Search key names|Record a key press) instead$/,
    });
  }

  /** What to press while recording, or what's wrong with the key. */
  @ayme.child
  get help(): Locator {
    return this.card.getByRole("status", { name: `${this.path} help` });
  }

  /** Replaces the key with the one it names, e.g. "Use Shift+Tab". */
  @ayme.child
  get fixButton(): Locator {
    return this.card.getByRole("button", { name: /^Use / });
  }

  /** While searching: the key names that match. */
  @ayme.collection
  get options(): Locator {
    return this.card
      .getByRole("listbox", { name: "Key names" })
      .getByRole("option");
  }

  /** Whether the field records a key press or searches key names. */
  @ayme.action({
    description: "Whether the field records a key press or searches key names.",
  })
  async mode(): Promise<"record" | "search"> {
    return (await this.modeButton.getAttribute("aria-label")) ===
      "Search key names instead"
      ? "record"
      : "search";
  }

  /** Records a key press, e.g. "F5" or "Control+c", as Playwright names it. */
  @ayme.action({
    description:
      "Records a key press, e.g. F5 or Control+c, as Playwright names it.",
  })
  async record(key: string) {
    await this.input.focus();
    await this.input.press(key);
  }

  /** Switches to searching and types a key name, e.g. "arr" or "shift+tab". */
  @ayme.action({ description: "Switches to searching and types a key name." })
  async search(text: string) {
    await this.input.focus();
    if ((await this.mode()) === "record") await this.input.press("Escape");
    await this.input.fill(text);
  }
}
