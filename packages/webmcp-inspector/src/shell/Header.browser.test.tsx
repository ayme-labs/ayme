import { afterEach, expect, it, vi } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";

import { renderPart } from "../renderPart";
import { InspectorHeader } from "../testing";
import { Header } from "./Header";
import type { Layout, ThemePreference } from "./preferences";

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
  onThemeChange = vi.fn(),
  onLayoutChange = vi.fn(),
  onCollapse = vi.fn(),
}: {
  theme?: ThemePreference;
  layout?: Layout;
  onThemeChange?: (theme: ThemePreference) => void;
  onLayoutChange?: (layout: Layout) => void;
  onCollapse?: () => void;
} = {}) {
  unmounts.push(
    renderPart(
      <Header
        pageName="ListPage"
        layout={layout}
        theme={theme}
        onThemeChange={onThemeChange}
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
