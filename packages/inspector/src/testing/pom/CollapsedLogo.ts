import { ayme } from "@ayme-dev/ayme";

import { PanelPart } from "./PanelPart";
import { dragBy } from "./pointerDrag";

/** The collapsed Inspector: the ayme logo, which opens the panel. */
export class CollapsedLogo extends PanelPart {
  @ayme.action({ description: "Opens the panel." })
  async open() {
    await this.root.click();
  }

  @ayme.action({ description: "Drags the logo by a distance in pixels." })
  async dragBy(deltaX: number, deltaY: number) {
    await dragBy(this.root, deltaX, deltaY);
  }
}
