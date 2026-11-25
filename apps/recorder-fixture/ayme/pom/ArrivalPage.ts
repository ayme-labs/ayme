import { ayme } from "@ayme-dev/ayme";

import { FixturePage } from "./FixturePage";

export class ArrivalPage extends FixturePage {
  readonly path = "/arrival.html";

  @ayme.child
  get heading() {
    return this.page.getByRole("heading", { name: "Arrived" });
  }

  @ayme.child
  get countUpButton() {
    return this.page.getByRole("button", { name: "Count up" });
  }

  @ayme.child({ description: '"Count: <n>".' })
  get count() {
    return this.page.getByText("Count:");
  }
}
