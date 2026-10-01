import type { Locator } from "@playwright/test";

import { dragBy } from "./pointerDrag";

/** The collapsed Inspector: the ayme logo, which opens the panel. */
export class CollapsedLogo {
  readonly root: Locator;

  constructor(root: Locator) {
    this.root = root;
  }

  async open() {
    await this.root.click();
  }

  async dragBy(deltaX: number, deltaY: number) {
    await dragBy(this.root, deltaX, deltaY);
  }
}
