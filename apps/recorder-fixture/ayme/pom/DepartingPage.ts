import { ayme } from "@ayme-dev/ayme";

import { FixturePage } from "./FixturePage";

export class DepartingPage extends FixturePage {
  readonly path = "/departing.html";

  @ayme.child({
    description: "Goes to the arrival page by itself 1.5 s after its click.",
  })
  readonly departButton = this.page.getByRole("button", {
    name: "Depart shortly",
  });
  @ayme.child({ description: '"Staying", then "Departing" once clicked.' })
  readonly state = this.page.locator("#state");
}
