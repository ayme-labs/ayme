import { ayme } from "@ayme-dev/ayme";

import { AppComponent } from "./AppComponent";

/** An item on the fixture page's list: a Page Object in a collection. */
export class ListItem extends AppComponent {
  @ayme.action
  async mark(state: "done" | "todo") {
    await this.root.evaluate(
      (item, value) => item.setAttribute("data-state", value),
      state
    );
  }
}
