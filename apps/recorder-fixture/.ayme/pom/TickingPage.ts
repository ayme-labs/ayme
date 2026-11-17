import { ayme } from "@ayme-dev/ayme";

import { FixturePage } from "./FixturePage";

export class TickingPage extends FixturePage {
  readonly path = "/ticking.html";

  @ayme.child({
    description: "Changes the ticks every 100 ms until Stop ticking.",
  })
  readonly startButton = this.page.getByRole("button", {
    name: "Start ticking",
  });
  @ayme.child({ description: 'Stops the ticks, and says "Stopped".' })
  readonly stopButton = this.page.getByRole("button", {
    name: "Stop ticking",
  });
  @ayme.child({ description: '"Not stopped", then "Stopped".' })
  readonly state = this.page.locator("#state");
}
