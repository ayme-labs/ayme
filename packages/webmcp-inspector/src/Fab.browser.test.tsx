import { afterEach, expect, it, vi } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";

import { Fab } from "./Fab";
import { renderPart } from "./renderPart";
import { CollapsedLogo } from "./testing";

// Component tests: the collapsed logo rendered alone with fixture props, in
// an open shadow root, driven by its page object on playwright-lite.

const page = createPage();
const logo = new CollapsedLogo(
  page.getByRole("button", { name: "Open Ayme POM inspector" })
);
const unmounts: (() => void)[] = [];

afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
});

it("opens the panel when the logo is clicked", async () => {
  const onOpen = vi.fn();
  unmounts.push(renderPart(<Fab onOpen={onOpen} />));

  await logo.open();

  expect(onOpen).toHaveBeenCalledOnce();
});

// First check (#182): playwright-lite can drive a pointer drag.
it("moves the logo by a drag, without opening the panel", async () => {
  const onOpen = vi.fn();
  unmounts.push(renderPart(<Fab onOpen={onOpen} />));
  const before = await logo.root.boundingBox();

  await logo.dragBy(-120, -80);

  await expect
    .poll(async () => {
      const after = await logo.root.boundingBox();
      return { x: after!.x - before!.x, y: after!.y - before!.y };
    })
    .toEqual({ x: -120, y: -80 });
  expect(onOpen).not.toHaveBeenCalled();
});
