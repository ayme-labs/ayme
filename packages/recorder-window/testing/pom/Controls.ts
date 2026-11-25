import { ayme } from "@ayme-dev/ayme";
import type { Locator } from "@playwright/test";

import { RecorderPart } from "./parts";

/** A control's name, as its button reads. */
export type CommandName =
  "Record" | "Stop" | "Continue recording" | "Clear" | "Finish";

/** The window's theme choices, as its switch names them. */
export type ThemeChoice = "System" | "Light" | "Dark";

/** The window's controls, in the bar above the recording. */
export class Controls extends RecorderPart {
  @ayme.child
  get recordButton(): Locator {
    return this.button("Record");
  }
  @ayme.child
  get stopButton(): Locator {
    return this.button("Stop");
  }
  @ayme.child
  get continueButton(): Locator {
    return this.button("Continue recording");
  }
  /** Assert visibility: pressed, it enters picking, or leaves it. */
  @ayme.child
  get assertVisibility(): Locator {
    return this.button("Assert visibility");
  }
  @ayme.child
  get clearButton(): Locator {
    return this.button("Clear");
  }
  @ayme.child
  get finishButton(): Locator {
    return this.button("Finish");
  }
  /** The System / Light / Dark switch: each press moves to the next. */
  @ayme.child
  get themeSwitch(): Locator {
    return this.root.getByRole("button", { name: /^Theme: / });
  }
  /** What the recorder does, when the controls do not show it already:
   * connecting, wrapping up, saving, the end. Empty otherwise. */
  @ayme.child
  get status(): Locator {
    return this.root.getByRole("status");
  }

  /** The controls that can be pressed now, in the order the window shows
   * them. */
  async offered(): Promise<CommandName[]> {
    const controls: [CommandName, Locator][] = [
      ["Record", this.recordButton],
      ["Stop", this.stopButton],
      ["Continue recording", this.continueButton],
      ["Clear", this.clearButton],
      ["Finish", this.finishButton],
    ];
    const offered: CommandName[] = [];
    for (const [name, control] of controls)
      if ((await control.count()) > 0 && (await control.isEnabled()))
        offered.push(name);
    return offered;
  }

  /** Whether the window shows Assert visibility on. */
  async picking(): Promise<boolean> {
    return (
      (await this.assertVisibility.getAttribute("aria-pressed")) === "true"
    );
  }

  /** The theme the switch is on. */
  async theme(): Promise<ThemeChoice> {
    const name = (await this.themeSwitch.getAttribute("aria-label")) ?? "";
    return /^Theme: (\w+)\./.exec(name)![1] as ThemeChoice;
  }

  /** Presses the theme switch until it is on `choice`. */
  @ayme.action({
    description: "Sets the window's theme: System, Light or Dark.",
  })
  async chooseTheme(choice: ThemeChoice): Promise<this> {
    for (let presses = 0; presses < 3; presses += 1) {
      if ((await this.theme()) === choice) return this;
      await this.themeSwitch.click();
    }
    throw new Error(`The theme switch never reached ${choice}.`);
  }

  private button(name: string): Locator {
    return this.root.getByRole("button", { name, exact: true });
  }
}
