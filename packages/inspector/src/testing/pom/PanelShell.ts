import { ayme } from "@ayme-dev/ayme";
import type { Locator } from "@playwright/test";

import { dragBy } from "./pointerDrag";

export type PanelEdge = "left" | "right" | "top" | "bottom";
export type PanelCorner =
  "top-left" | "top-right" | "bottom-left" | "bottom-right";

/** The expanded panel's frame: where it sits and how it resizes. */
@ayme
export class PanelShell {
  readonly root: Locator;

  constructor(root: Locator) {
    this.root = root;
  }

  /** The handle that resizes the panel from one of its edges or corners. */
  resizeHandle(handle: PanelEdge | PanelCorner): Locator {
    const kind = handle.includes("-") ? "corner" : "edge";
    return this.root.getByRole("separator", {
      name: `Resize from the ${handle} ${kind}`,
    });
  }

  @ayme.action({
    description:
      "Resizes the panel from one edge or corner by a distance in pixels.",
  })
  async resizeBy(
    handle: PanelEdge | PanelCorner,
    deltaX: number,
    deltaY: number
  ) {
    await dragBy(this.resizeHandle(handle), deltaX, deltaY);
  }

  /** Where the panel is, in viewport pixels. */
  @ayme.action({ description: "Reads where the panel is, in viewport pixels." })
  async box() {
    const box = await this.root.boundingBox();
    if (!box) throw new Error("The panel is not visible.");
    return box;
  }
}
