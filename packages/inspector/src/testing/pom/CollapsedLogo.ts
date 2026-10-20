import { ayme } from "@ayme-dev/ayme";
import type { Locator } from "@playwright/test";

import { PanelPart } from "./PanelPart";
import { dragBy } from "./pointerDrag";

/** The collapsed Inspector: the ayme logo, which opens the panel. */
@ayme
export class CollapsedLogo extends PanelPart {
  constructor(root: Locator) {
    super(root);
  }

  @ayme.action({ description: "Opens the panel." })
  async open() {
    await this.root.click();
  }

  @ayme.action({ description: "Drags the logo by a distance in pixels." })
  async dragBy(deltaX: number, deltaY: number) {
    await dragBy(this.root, deltaX, deltaY);
  }
}
