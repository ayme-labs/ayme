import { ayme } from "@ayme-dev/ayme";

import { FixturePage } from "./FixturePage";

/** Panels a press outside closes, each heard in another way: a click on the
 * document, a pointerdown or a mousedown on it in the capture phase, and the
 * focus leaving the panel. */
export class OutsideClickPage extends FixturePage {
  readonly path = "/outside-click.html";

  @ayme.child
  readonly openClickPanelButton = this.page.getByRole("button", {
    name: "Open click panel",
  });
  @ayme.child({
    description: "Closes on a click outside it, heard on the document.",
  })
  readonly clickPanel = this.page.getByRole("group", { name: "Click panel" });
  @ayme.child
  readonly insideClickPanelButton = this.page.getByRole("button", {
    name: "Inside click panel",
  });

  @ayme.child
  readonly openPointerdownPanelButton = this.page.getByRole("button", {
    name: "Open pointerdown panel",
  });
  @ayme.child({
    description:
      "Closes on a pointerdown outside it, heard on the document in the capture phase.",
  })
  readonly pointerdownPanel = this.page.getByRole("group", {
    name: "Pointerdown panel",
  });
  @ayme.child
  readonly insidePointerdownPanelButton = this.page.getByRole("button", {
    name: "Inside pointerdown panel",
  });

  @ayme.child
  readonly openMousedownPanelButton = this.page.getByRole("button", {
    name: "Open mousedown panel",
  });
  @ayme.child({
    description:
      "Closes on a mousedown outside it, heard on the document in the capture phase.",
  })
  readonly mousedownPanel = this.page.getByRole("group", {
    name: "Mousedown panel",
  });
  @ayme.child
  readonly insideMousedownPanelButton = this.page.getByRole("button", {
    name: "Inside mousedown panel",
  });

  @ayme.child
  readonly openFocusoutPanelButton = this.page.getByRole("button", {
    name: "Open focusout panel",
  });
  @ayme.child({
    description: "Takes the focus when opened, and closes when it leaves.",
  })
  readonly focusoutPanel = this.page.getByRole("group", {
    name: "Focusout panel",
  });
  @ayme.child
  readonly insideFocusoutPanelButton = this.page.getByRole("button", {
    name: "Inside focusout panel",
  });
}
