// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PortalContainerProvider } from "@ayme-dev/design-system/lib/portal-container";

import { Popover, PopoverContent, PopoverTrigger } from "./popover";

const roots: Root[] = [];

beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  document.body.replaceChildren();
});

function render(element: HTMLElement, children: ReactNode) {
  const root = createRoot(element);
  roots.push(root);
  act(() => root.render(children));
}

function openPopover() {
  return (
    <Popover open>
      <PopoverTrigger>Open</PopoverTrigger>
      <PopoverContent>Details</PopoverContent>
    </Popover>
  );
}

describe("PopoverContent", () => {
  it("portals into document.body by default", () => {
    const panel = document.createElement("div");
    document.body.append(panel);

    render(panel, openPopover());

    const content = document.querySelector('[data-slot="popover-content"]');
    expect(content?.textContent).toBe("Details");
    expect(panel.contains(content)).toBe(false);
  });

  it("portals into the provided container inside a shadow root", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const panel = document.createElement("div");
    panel.className = "dark";
    host.attachShadow({ mode: "open" }).append(panel);

    render(
      panel,
      <PortalContainerProvider value={panel}>
        {openPopover()}
      </PortalContainerProvider>
    );

    const content = panel.querySelector('[data-slot="popover-content"]');
    expect(content?.textContent).toBe("Details");
    expect(content?.closest(".dark")).toBe(panel);
    expect(document.querySelector('[data-slot="popover-content"]')).toBeNull();
  });

  it("prefers its own container over the provided one", () => {
    const panel = document.createElement("div");
    const layer = document.createElement("div");
    document.body.append(panel, layer);

    render(
      panel,
      <PortalContainerProvider value={panel}>
        <Popover open>
          <PopoverTrigger>Open</PopoverTrigger>
          <PopoverContent container={layer}>Details</PopoverContent>
        </Popover>
      </PortalContainerProvider>
    );

    expect(layer.querySelector('[data-slot="popover-content"]')).not.toBeNull();
  });
});
