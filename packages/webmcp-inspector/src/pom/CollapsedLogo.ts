import type { Locator } from "@playwright/test";

/** The collapsed Inspector: the ayme logo, which opens the panel. */
export class CollapsedLogo {
  readonly root: Locator;

  constructor(root: Locator) {
    this.root = root;
  }

  async open() {
    await this.root.click();
  }

  /**
   * Drags the logo by an offset. playwright-lite has no `page.mouse` and no
   * `dragTo`, so the drag is a sequence of pointer events dispatched to the
   * logo, the element a real drag would capture the pointer on. This runs
   * the same on Playwright and on playwright-lite.
   */
  async dragBy(deltaX: number, deltaY: number) {
    const box = await this.root.boundingBox();
    if (!box) throw new Error("The collapsed logo is not visible.");
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    const pointer = (clientX: number, clientY: number, buttons: number) => ({
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      buttons,
      clientX,
      clientY,
      bubbles: true,
      cancelable: true,
      composed: true,
    });
    await this.root.dispatchEvent("pointerdown", pointer(x, y, 1));
    const steps = 4;
    for (let step = 1; step <= steps; step += 1) {
      const progress = step / steps;
      await this.root.dispatchEvent(
        "pointermove",
        pointer(x + deltaX * progress, y + deltaY * progress, 1)
      );
    }
    await this.root.dispatchEvent(
      "pointerup",
      pointer(x + deltaX, y + deltaY, 0)
    );
  }
}
