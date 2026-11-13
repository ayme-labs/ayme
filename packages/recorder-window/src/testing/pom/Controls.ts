import type { Locator } from "@playwright/test";

/** A control's name, as its button reads. */
export type CommandName = "Record" | "Stop" | "Continue" | "Clear" | "Finish";

const NAMES: readonly CommandName[] = [
  "Record",
  "Stop",
  "Continue",
  "Clear",
  "Finish",
];

/** The window's controls, and the line that says what the recorder does. */
export class Controls {
  /** What the recorder is doing, in words: "Recording", "Paused" and so on. */
  readonly status: Locator;

  constructor(readonly root: Locator) {
    this.status = root.getByRole("status");
  }

  button(name: CommandName): Locator {
    return this.root.getByRole("button", { name, exact: true });
  }

  /** The controls that can be pressed now, in the order the window shows
   * them. */
  async offered(): Promise<CommandName[]> {
    const offered: CommandName[] = [];
    for (const name of NAMES) {
      const button = this.button(name);
      if ((await button.count()) > 0 && (await button.isEnabled()))
        offered.push(name);
    }
    return offered;
  }

  async press(name: CommandName): Promise<void> {
    await this.button(name).click();
  }
}
