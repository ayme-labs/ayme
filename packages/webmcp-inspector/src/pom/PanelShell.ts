import type { Locator } from "@playwright/test";

import { dragBy } from "./pointerDrag";

export type PanelEdge = "left" | "right" | "top" | "bottom";

/** The expanded panel's frame: where it sits and how it resizes. */
export class PanelShell {
  readonly root: Locator;

  constructor(root: Locator) {
    this.root = root;
  }

  /** The handle that resizes the panel from one of its edges. */
  resizeHandle(edge: PanelEdge): Locator {
    return this.root.getByRole("separator", {
      name: `Resize from the ${edge} edge`,
    });
  }

  async resizeBy(edge: PanelEdge, deltaX: number, deltaY: number) {
    await dragBy(this.resizeHandle(edge), deltaX, deltaY);
  }

  /** Where the panel is, in viewport pixels. */
  async box() {
    const box = await this.root.boundingBox();
    if (!box) throw new Error("The panel is not visible.");
    return box;
  }
}
