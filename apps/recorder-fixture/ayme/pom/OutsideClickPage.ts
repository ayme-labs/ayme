import { ayme } from "@ayme-dev/ayme";

import { FixturePage } from "./FixturePage";

/** Panels a press outside closes, each heard in another way: a click on the
 * document, a pointerdown or a mousedown on it in the capture phase, the
 * focus leaving the panel, and the browser's own light dismiss of a
 * popover. */
export class OutsideClickPage extends FixturePage {
  readonly path = "/outside-click.html";

  @ayme.child
  get openClickPanelButton() {
    return this.page.getByRole("button", {
      name: "Open click panel",
    });
  }

  @ayme.child({
    description: "Closes on a click outside it, heard on the document.",
  })
  get clickPanel() {
    return this.page.getByRole("group", { name: "Click panel" });
  }

  @ayme.child
  get insideClickPanelButton() {
    return this.page.getByRole("button", {
      name: "Inside click panel",
    });
  }

  @ayme.child
  get openPointerdownPanelButton() {
    return this.page.getByRole("button", {
      name: "Open pointerdown panel",
    });
  }

  @ayme.child({
    description:
      "Closes on a pointerdown outside it, heard on the document in the capture phase.",
  })
  get pointerdownPanel() {
    return this.page.getByRole("group", {
      name: "Pointerdown panel",
    });
  }

  @ayme.child
  get insidePointerdownPanelButton() {
    return this.page.getByRole("button", {
      name: "Inside pointerdown panel",
    });
  }

  @ayme.child
  get openMousedownPanelButton() {
    return this.page.getByRole("button", {
      name: "Open mousedown panel",
    });
  }

  @ayme.child({
    description:
      "Closes on a mousedown outside it, heard on the document in the capture phase.",
  })
  get mousedownPanel() {
    return this.page.getByRole("group", {
      name: "Mousedown panel",
    });
  }

  @ayme.child
  get insideMousedownPanelButton() {
    return this.page.getByRole("button", {
      name: "Inside mousedown panel",
    });
  }

  @ayme.child
  get openFocusoutPanelButton() {
    return this.page.getByRole("button", {
      name: "Open focusout panel",
    });
  }

  @ayme.child({
    description: "Takes the focus when opened, and closes when it leaves.",
  })
  get focusoutPanel() {
    return this.page.getByRole("group", {
      name: "Focusout panel",
    });
  }

  @ayme.child
  get insideFocusoutPanelButton() {
    return this.page.getByRole("button", {
      name: "Inside focusout panel",
    });
  }

  @ayme.child
  get openPopoverButton() {
    return this.page.getByRole("button", { name: "Open popover" });
  }

  @ayme.child({
    description:
      'A popover="auto", which the browser closes on a press outside it.',
  })
  get popoverPanel() {
    return this.page.getByRole("group", { name: "Popover panel" });
  }

  @ayme.child
  get insidePopoverButton() {
    return this.page.getByRole("button", { name: "Inside popover" });
  }
}
