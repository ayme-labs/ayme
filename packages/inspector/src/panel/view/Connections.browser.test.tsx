import { afterEach, expect, it, vi } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";

import { renderPart } from "../../testing/renderPart";
import { Connections as ConnectionsPart } from "../../testing";
import type {
  AgentConnectionStatus,
  PublicationStatus,
} from "../domain/connections";
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
  agent,
  webMCP = { state: "disabled", message: "" },
  tools = 2,
  onCopy = vi.fn(),
}: {
  agent: AgentConnectionStatus;
  webMCP?: PublicationStatus;
  tools?: number;
  onCopy?: (text: string) => void;
}) {
  unmounts.push(
    renderPart(
      <Connections
        agent={agent}
        webMCP={webMCP}
        tools={tools}
        onCopy={onCopy}
      />
    )
  );
}

const agents = {
  off: { state: "off" },
  "not connected": { state: "not-connected", reason: "no-server" },
  connected: { state: "connected", agent: "claude-code" },
} satisfies Record<string, AgentConnectionStatus>;

const pills = {
  off: "No agent",
  "not connected": "Not connected",
  connected: "Claude Code",
};

const publications = {
  active: { state: "active", message: "" },
  disabled: { state: "disabled", message: "WebMCP publication is disabled." },
  unavailable: {
    state: "unavailable",
    message: "The WebMCP driver is unavailable.",
  },
  failed: { state: "failed", message: "WebMCP publication failed: boom." },
} satisfies Record<string, PublicationStatus>;

const combinations = Object.keys(agents).flatMap((agent) =>
  Object.keys(publications).map(
    (webMCP) =>
      [agent, webMCP] as [keyof typeof agents, keyof typeof publications]
  )
);

it.each(combinations)(
  "with the agent %s and WebMCP %s, the pill speaks of the agent only, marked when WebMCP is broken",
  async (agent, webMCP) => {
    renderConnections({ agent: agents[agent], webMCP: publications[webMCP] });

    await expect.poll(() => connections.pill.textContent()).toBe(pills[agent]);
    const broken = webMCP === "unavailable" || webMCP === "failed";
    expect(await connections.pill.getAttribute("aria-label")).toBe(
      `Connections: ${
        agent === "off"
          ? "agent connection off"
          : agent === "connected"
            ? "Claude Code connected"
            : "agent not connected"
      }${broken ? `, WebMCP ${webMCP}` : ""}`
    );

    await connections.open();
    await expect
      .poll(() => connections.agent.state.textContent())
      .toBe(
        {
          off: "Off",
          "not connected": "Not connected",
          connected: "Connected",
        }[agent]
      );
    expect(await connections.webMCP.state.textContent()).toBe(
      {
        active: "Published",
        disabled: "Off",
        unavailable: "Unavailable",
        failed: "Failed",
      }[webMCP]
    );
    expect(await connections.popover.textContent()).not.toContain(
      "can't call these tools"
    );
  }
);

it("names the connected agent and how it reaches the tab", async () => {
  renderConnections({ agent: agents.connected });

  await connections.open();

  await expect
    .poll(() => connections.agent.root.textContent())
    .toContain("Claude Code is connected to this tab through ayme mcp.");
});

it("says why the agent is not connected, and how to connect it", async () => {
  renderConnections({
    agent: { state: "not-connected", reason: "several-servers" },
  });

  await connections.open();

  await expect
    .poll(() => connections.agent.root.textContent())
    .toContain(
      "More than one ayme MCP server is running, so this tab won't guess which one."
    );
  expect(await connections.agent.root.textContent()).toContain(
    "Ask your agent to call ayme_connect and open the link it gives you."
  );
});

it("counts the tools WebMCP publishes", async () => {
  renderConnections({
    agent: agents.off,
    webMCP: publications.active,
    tools: 4,
  });

  await connections.open();

  await expect
    .poll(() => connections.webMCP.root.textContent())
    .toContain("4 tools published to agents in this browser.");
});

it("copies the option that turns a path on", async () => {
  const onCopy = vi.fn();
  renderConnections({ agent: agents.off, onCopy });
  await connections.open();

  await connections.agent.copyButton.click();
  await connections.webMCP.copyButton.click();

  expect(onCopy.mock.calls).toEqual([
    ["agentConnection: true"],
    ["webMCP: { enabled: true }"],
  ]);
});

it("offers nothing to copy for a path that is on", async () => {
  renderConnections({ agent: agents.connected, webMCP: publications.active });

  await connections.open();

  await expect.poll(() => connections.popover.count()).toBe(1);
  expect(await connections.agent.copyButton.count()).toBe(0);
  expect(await connections.webMCP.copyButton.count()).toBe(0);
});
