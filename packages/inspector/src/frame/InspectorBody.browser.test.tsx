import { afterEach, expect, it } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";

import { renderPart } from "../renderPart";
import type { Layout } from "../shell/preferences";
import { DetailPane, InspectorBody, RunsRegion } from "./InspectorBody";

// Component tests: where the body puts Runs, rendered in a panel-sized box.

const page = createPage();
const navigator = page.getByRole("navigation", { name: "Navigator" });
const detail = page.getByRole("region", { name: "Selected" });
const runs = page.getByRole("region", { name: "Runs" });
const unmounts: (() => void)[] = [];

afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
});

function renderBody(layout: Layout, size: { width: number; height: number }) {
  unmounts.push(
    renderPart(
      <div className="flex flex-col" style={size}>
        <InspectorBody
          layout={layout}
          navigator={<nav aria-label="Navigator" className="w-[290px]" />}
          detail={<DetailPane>The detail</DetailPane>}
          runs={<RunsRegion>The runs</RunsRegion>}
        />
      </div>
    )
  );
}

async function box(locator: typeof runs) {
  const found = await locator.boundingBox();
  if (!found) throw new Error("The part is not visible.");
  return found;
}

it.each(["float", "left", "right"] as const)(
  "puts Runs below the navigator and the detail when %s",
  async (layout) => {
    renderBody(layout, { width: 760, height: 700 });

    await expect.poll(async () => (await box(runs)).width).toBe(760);
    const runsTop = (await box(runs)).y;
    const detailBox = await box(detail);
    expect(runsTop).toBe(detailBox.y + detailBox.height);
    expect(runsTop).toBeGreaterThan((await box(navigator)).y);
  }
);

it("puts Runs in a third column when docked to the bottom", async () => {
  renderBody("bottom", { width: 1280, height: 360 });

  await expect.poll(async () => (await box(runs)).height).toBe(360);
  const detailBox = await box(detail);
  expect((await box(navigator)).x).toBeLessThan(detailBox.x);
  expect((await box(runs)).x).toBe(detailBox.x + detailBox.width);
});
