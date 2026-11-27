import { afterEach, expect, it, vi } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";

import { renderPart } from "../../../testing/renderPart";
import { Connections as ConnectionsPart } from "../../../testing";
import type { PublicationStatus } from "../domain/connections";
import { Connections } from "./Connections";

// Component tests: the Connections pill and its popover rendered alone with
// fixture statuses, read and driven through their page object.

const page = createPage();
const connections = new ConnectionsPart(
  page.locator(":root"),
  page.locator("[data-ayme-inspector-root]")
);
const unmounts: (() => void)[] = [];

afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
});

function renderConnections({
  webMCP = { state: "disabled", message: "" },
  tools = [],
  onCopy = vi.fn(),
  copied,
}: {
  webMCP?: PublicationStatus;
  tools?: readonly { name: string; group?: string }[];
  onCopy?: (text: string) => void;
  copied?: string;
} = {}) {
  unmounts.push(
    renderPart(
      <Connections
        webMCP={webMCP}
        tools={tools}
        onCopy={onCopy}
        copied={copied}
      />
    )
  );
}

const publications = {
  active: { state: "active", message: "" },
  disabled: { state: "disabled", message: "WebMCP publication is disabled." },
  unavailable: {
    state: "unavailable",
    message: "The WebMCP driver is unavailable.",
  },
  failed: { state: "failed", message: "WebMCP publication failed: boom." },
} satisfies Record<string, PublicationStatus>;

const states = {
  active: "Published",
  disabled: "Off",
  unavailable: "Unavailable",
  failed: "Failed",
};

const tones = {
  active: "ok",
  disabled: "off",
  unavailable: "warning",
  failed: "error",
};

it.each(Object.keys(publications) as (keyof typeof publications)[])(
  "with WebMCP %s, the pill and the popover's row say so",
  async (webMCP) => {
    renderConnections({ webMCP: publications[webMCP] });

    await expect.poll(() => connections.pill.textContent()).toBe("WebMCP");
    expect(await connections.pill.getAttribute("aria-label")).toBe(
      `Connections: WebMCP ${states[webMCP].toLowerCase()}`
    );
    expect(await connections.pillDot.getAttribute("data-tone")).toBe(
      tones[webMCP]
    );

    await connections.open();
    await expect
      .poll(() => connections.webMCP.state.textContent())
      .toBe(states[webMCP]);
    expect(await connections.webMCP.dot.getAttribute("data-tone")).toBe(
      tones[webMCP]
    );
  }
);

it("counts the tools WebMCP publishes, which leaves out Peek tools", async () => {
  renderConnections({
    webMCP: publications.active,
    tools: [
      { name: "ListPage.addItem", group: "pageObject" },
      { name: "ListPage.clear", group: "pageObject" },
      { name: "snapshot", group: "agent" },
      { name: "click", group: "browser" },
      { name: "peek.jobs", group: "peek" },
    ],
  });

  await connections.open();

  await expect
    .poll(() => connections.webMCP.root.textContent())
    .toContain("4 tools published to agents in this browser.");
});

it("copies the option that turns WebMCP on", async () => {
  const onCopy = vi.fn();
  renderConnections({ onCopy });
  await connections.open();

  await connections.webMCP.copyButton.click();

  expect(onCopy.mock.calls).toEqual([["webMCP: { enabled: true }"]]);
});

it("gives the copy button at least 24px each way to press", async () => {
  renderConnections();

  await connections.open();

  const box = await connections.webMCP.copyButton.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(24);
  expect(box?.height).toBeGreaterThanOrEqual(24);
});

it("tells assistive technology which option it copied", async () => {
  renderConnections({ copied: "webMCP: { enabled: true }" });

  await connections.open();

  await expect
    .poll(() => connections.webMCP.root.getByRole("status").textContent())
    .toBe("Copied");
});

it("offers nothing to copy while WebMCP is on", async () => {
  renderConnections({ webMCP: publications.active });

  await connections.open();

  await expect.poll(() => connections.popover.count()).toBe(1);
  expect(await connections.webMCP.copyButton.count()).toBe(0);
});
