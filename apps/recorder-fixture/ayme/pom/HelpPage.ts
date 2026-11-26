import { ayme } from "@ayme-dev/ayme";

import { FixturePage } from "./FixturePage";

export class HelpPage extends FixturePage {
  readonly path = "/help.html";

  @ayme.child
  get thanksButton() {
    return this.page.getByRole("button", { name: "Thanks" });
  }

  // Not by its text, which is what changes.
  @ayme.child({
    description: 'How often it was thanked: "Not thanked", then "Thanked <n>".',
  })
  get thanked() {
    return this.page.locator("#thanked");
  }
}
