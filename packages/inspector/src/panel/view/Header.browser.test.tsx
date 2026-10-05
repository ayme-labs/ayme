import { afterEach, expect, it, vi } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";

import { renderPart } from "../../testing/renderPart";
import { InspectorHeader } from "../../testing";
import { Header } from "./Header";
import type { Layout, ThemePreference } from "../domain/preferences";

// Component tests: the header rendered alone with fixture props, driven by
// its page object on playwright-lite. Each checks what the header shows or
// which callback it calls.

const page = createPage();
const header = new InspectorHeader(
  page.locator("header"),
  page.locator("[data-ayme-inspector-root]")
);
const unmounts: (() => void)[] = [];

afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
});

function renderHeader({
  theme = "system",
  layout = "float",
  glass = true,
  onThemeChange = vi.fn(),
  onGlassChange = vi.fn(),
  onLayoutChange = vi.fn(),
  onCollapse = vi.fn(),
}: {
  theme?: ThemePreference;
  layout?: Layout;
  glass?: boolean;
  onThemeChange?: (theme: ThemePreference) => void;
  onGlassChange?: (glass: boolean) => void;
  onLayoutChange?: (layout: Layout) => void;
  onCollapse?: () => void;
} = {}) {
  unmounts.push(
    renderPart(
      <Header
        pageName="ListPage"
        layout={layout}
        theme={theme}
        glass={glass}
        onThemeChange={onThemeChange}
        onGlassChange={onGlassChange}
        onLayoutChange={onLayoutChange}
        onCollapse={onCollapse}
      />
    )
  );
}

it("is titled ayme and names the page it inspects", async () => {
  renderHeader();

  await expect.poll(() => header.title.textContent()).toBe("ayme");
  await expect.poll(() => header.pageBadge.textContent()).toBe("ListPage");
});

it.each([
  ["system", "Light", "light"],
  ["light", "Dark", "dark"],
  ["dark", "System", "system"],
] as const)(
  "the theme switch moves from %s to %s",
  async (theme, _nextLabel, next) => {
    const onThemeChange = vi.fn();
    renderHeader({ theme, onThemeChange });

    await header.themeSwitch.button.click();

    expect(onThemeChange).toHaveBeenCalledExactlyOnceWith(next);
  }
);

it("shows the theme it's set to", async () => {
  renderHeader({ theme: "dark" });

  await expect.poll(() => header.themeSwitch.current()).toBe("Dark");
});

it.each([true, false])(
  "shows whether the panel is glass (%s)",
  async (glass) => {
    renderHeader({ glass });

    await expect.poll(() => header.glassSwitch.isOn()).toBe(glass);
  }
);

it.each([
  [true, false],
  [false, true],
])("the glass switch turns glass from %s to %s", async (glass, next) => {
  const onGlassChange = vi.fn();
  renderHeader({ glass, onGlassChange });

  await header.glassSwitch.button.click();

  expect(onGlassChange).toHaveBeenCalledExactlyOnceWith(next);
});

it.each([
  ["Floating", "float"],
  ["Dock left", "left"],
  ["Dock right", "right"],
  ["Dock to bottom", "bottom"],
] as const)("the layout menu switches to %s", async (choice, layout) => {
  const onLayoutChange = vi.fn();
  renderHeader({
    layout: layout === "float" ? "left" : "float",
    onLayoutChange,
  });

  await header.layoutMenu.choose(choice);

  expect(onLayoutChange).toHaveBeenCalledExactlyOnceWith(layout);
});

it("shows the layout the panel is in", async () => {
  renderHeader({ layout: "bottom" });

  await expect.poll(() => header.layoutMenu.current()).toBe("Dock to bottom");
});

it("collapses the panel", async () => {
  const onCollapse = vi.fn();
  renderHeader({ onCollapse });

  await header.collapse();

  expect(onCollapse).toHaveBeenCalledOnce();
});
