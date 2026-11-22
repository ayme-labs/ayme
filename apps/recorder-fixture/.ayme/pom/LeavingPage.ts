import { ayme } from "@ayme-dev/ayme";

import { FixturePage } from "./FixturePage";

export class LeavingPage extends FixturePage {
  readonly path = "/leaving.html";

  @ayme.child({
    description:
      "Goes to the checkout as the mouse is released, before the click that follows.",
  })
  readonly leaveButton = this.page.getByRole("button", { name: "Leave" });
  @ayme.child
  readonly stayButton = this.page.getByRole("button", { name: "Stay" });
  // Not by its text, which is what changes.
  @ayme.child({ description: '"Not stayed", then "Stayed".' })
  readonly stayed = this.page.locator("#stayed");
}
