import { ayme } from "@ayme-dev/ayme";

import { FixturePage } from "./FixturePage";

export class HelpPage extends FixturePage {
  readonly path = "/help.html";

  @ayme.child
  readonly thanksButton = this.page.getByRole("button", { name: "Thanks" });
  // Not by its text, which is what changes.
  @ayme.child({
    description: 'How often it was thanked: "Not thanked", then "Thanked <n>".',
  })
  readonly thanked = this.page.locator("#thanked");
}
