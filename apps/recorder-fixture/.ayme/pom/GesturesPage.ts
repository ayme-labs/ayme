import { ayme } from "@ayme-dev/ayme";

import { FixturePage } from "./FixturePage";

/** What the gestures page has received and shows. */
export type GesturesState = {
  /** Every press, release and click, in order, as "<type> <target>". */
  readonly events: string[];
  readonly held: string;
  readonly position: string;
  /** The text selected now. */
  readonly selection: string;
};

/** Gestures that end in a click: a press, a drag and a text selection. */
export class GesturesPage extends FixturePage {
  readonly path = "/gestures.html";

  @ayme.child({
    description: "Reacts to the press itself, not to the click after it.",
  })
  readonly holdButton = this.page.getByRole("button", { name: "Hold me" });
  // Not by its text, which is what changes.
  @ayme.child({ description: '"Pressed <n>", then "Released <n>".' })
  readonly held = this.page.locator("#held");
  // The slider has no role: its track and handle are found by their ids.
  @ayme.child({ description: "A slider's handle, moved by dragging it." })
  readonly handle = this.page.locator("#handle");
  @ayme.child({ description: 'Where the handle is: "Handle at <n>".' })
  readonly position = this.page.getByText("Handle at");
  @ayme.child({ description: "Text to select by dragging across it." })
  readonly text = this.page.getByText("The quick brown fox jumps");

  /** What the page has received and shows now, read in one step. */
  async state(): Promise<GesturesState> {
    return (await this.page.evaluate(`({
      events: window.events,
      held: document.getElementById("held").textContent,
      position: document.getElementById("position").textContent,
      selection: String(getSelection()),
    })`)) as GesturesState;
  }

  /** The last press, release or click the page received. */
  async lastEvent(): Promise<string> {
    return (await this.page.evaluate("window.events.at(-1)")) as string;
  }
}
