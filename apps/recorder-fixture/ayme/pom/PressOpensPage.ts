import { ayme } from "@ayme-dev/ayme";

import { FixturePage } from "./FixturePage";

/** What the press-opens page has received and shows. */
export type PressOpensState = {
  /** Every press, release and click, in order, as "<type> <target>". */
  readonly events: string[];
  readonly city: string;
  readonly listOpen: boolean;
};

/** A select whose list opens on the press, over the field itself. */
export class PressOpensPage extends FixturePage {
  readonly path = "/press-opens.html";

  @ayme.child({
    description:
      "Opens its list on the press, not on the click after it, and shows the city picked.",
  })
  get city() {
    return this.page.getByRole("combobox", { name: "City" });
  }

  @ayme.child({
    description:
      "Comes up over the field. A click on an option picks it; a click beside the list closes it.",
  })
  get cities() {
    return this.page.getByRole("listbox", { name: "Cities" });
  }

  cityOption(name: string) {
    return this.page.getByRole("option", { name });
  }

  /** What the page has received and shows now, read in one step. */
  async state(): Promise<PressOpensState> {
    return (await this.page.evaluate(`({
      events: window.events,
      city: document.getElementById("city").textContent.trim(),
      listOpen: !document.getElementById("cities").hidden,
    })`)) as PressOpensState;
  }
}
