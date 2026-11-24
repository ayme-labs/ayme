import { ayme } from "@ayme-dev/ayme";

import { FixturePage } from "./FixturePage";

export class ArrivalPage extends FixturePage {
  readonly path = "/arrival.html";

  @ayme.child
  readonly heading = this.page.getByRole("heading", { name: "Arrived" });
  @ayme.child
  readonly countUpButton = this.page.getByRole("button", { name: "Count up" });
  @ayme.child({ description: '"Count: <n>".' })
  readonly count = this.page.getByText("Count:");
}
