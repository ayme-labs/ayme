import { useState } from "react";
import { afterEach, expect, it } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";

import { renderPart } from "../../testing/renderPart";
import { dragBy } from "../../testing/pom/pointerDrag";
import type { Layout, RegionSizes } from "../domain/preferences";
import { DetailPane, RunsRegion } from "../view/InspectorBody";
import { InspectorBody } from "./InspectorBody";

// Component tests: where the body puts Runs and how its dividers resize the
// navigator and Runs, rendered in a panel-sized box.

const page = createPage();
const navigator = page.getByRole("navigation", { name: "Navigator" });
const detail = page.getByRole("region", { name: "Selected" });
const runs = page.getByRole("region", { name: "Runs" });
const navigatorDivider = page.getByRole("separator", {
  name: "Resize the navigator",
});
const runsDivider = page.getByRole("separator", { name: "Resize Runs" });
const unmounts: (() => void)[] = [];

afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
});

function Body({ layout }: { layout: Layout }) {
  const [regions, setRegions] = useState<RegionSizes>({});
  return (
    <InspectorBody
      layout={layout}
      navigator={
        <nav
          aria-label="Navigator"
          className="w-navigator flex-none border-r in-data-[layout=bottom]:w-navigator-docked"
        />
      }
      detail={<DetailPane>The detail</DetailPane>}
      runs={<RunsRegion>The runs</RunsRegion>}
      regions={regions}
      onRegionsChange={setRegions}
    />
  );
}

function renderBody(layout: Layout, size: { width: number; height: number }) {
  unmounts.push(
    renderPart(
      <div className="flex flex-col" style={size}>
        <Body layout={layout} />
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

it("widens the navigator as its divider is dragged, within the room the detail keeps", async () => {
  renderBody("float", { width: 760, height: 700 });
  await expect.poll(async () => (await box(navigator)).width).toBe(290);

  await dragBy(navigatorDivider, 60, 0);
  await expect.poll(async () => (await box(navigator)).width).toBe(350);

  // The detail pane keeps 280px of the 760.
  await dragBy(navigatorDivider, 400, 0);
  await expect.poll(async () => (await box(navigator)).width).toBe(480);
});

it("grows Runs as the divider above it is dragged up", async () => {
  renderBody("float", { width: 760, height: 700 });
  await expect.poll(async () => (await box(runs)).height).toBe(250);

  await dragBy(runsDivider, 0, -100);

  await expect.poll(async () => (await box(runs)).height).toBe(350);
});

it("widens Runs as a column when docked to the bottom", async () => {
  renderBody("bottom", { width: 1280, height: 360 });
  await expect.poll(async () => (await box(runs)).width).toBe(420);

  await dragBy(runsDivider, -80, 0);

  await expect.poll(async () => (await box(runs)).width).toBe(500);
});

it("goes back to the default size on a double-click", async () => {
  renderBody("float", { width: 760, height: 700 });
  await dragBy(navigatorDivider, 60, 0);
  await expect.poll(async () => (await box(navigator)).width).toBe(350);

  await navigatorDivider.dblclick();

  await expect.poll(async () => (await box(navigator)).width).toBe(290);
});

it("moves a focused divider with the arrow keys", async () => {
  renderBody("float", { width: 760, height: 700 });
  await expect.poll(async () => (await box(navigator)).width).toBe(290);

  await navigatorDivider.focus();
  await navigatorDivider.press("ArrowRight");

  await expect.poll(async () => (await box(navigator)).width).toBe(306);
});
