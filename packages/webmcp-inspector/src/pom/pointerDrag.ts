import type { Locator } from "@playwright/test";

/**
 * Drags an element by an offset. playwright-lite has no `page.mouse` and no
 * `dragTo`, so the drag is a sequence of pointer events dispatched to the
 * element a real press would land on. The panel follows the drag on the
 * window, where these events bubble. This runs the same on Playwright and on
 * playwright-lite.
 */
export async function dragBy(handle: Locator, deltaX: number, deltaY: number) {
  const box = await handle.boundingBox();
  if (!box) throw new Error("The drag handle is not visible.");
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
  await handle.dispatchEvent("pointerdown", pointer(x, y, 1));
  const steps = 4;
  for (let step = 1; step <= steps; step += 1) {
    const progress = step / steps;
    await handle.dispatchEvent(
      "pointermove",
      pointer(x + deltaX * progress, y + deltaY * progress, 1)
    );
  }
  await handle.dispatchEvent("pointerup", pointer(x + deltaX, y + deltaY, 0));
}
