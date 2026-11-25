import { ayme } from "@ayme-dev/ayme";

import { FixturePage } from "./FixturePage";

export class SettlingPage extends FixturePage {
  readonly path = "/settling.html";

  @ayme.child({
    description: "Adds ten results, one every 100 ms, after its click.",
  })
  get loadButton() {
    return this.page.getByRole("button", {
      name: "Load results",
    });
  }

  @ayme.child
  get results() {
    return this.page.getByRole("listitem");
  }

  @ayme.child({ description: 'Sets the mark state to "Marked" at once.' })
  get markButton() {
    return this.page.getByRole("button", { name: "Mark" });
  }

  @ayme.child({ description: '"Not marked", then "Marked".' })
  get markState() {
    return this.page.locator("#mark-state");
  }
}
