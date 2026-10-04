import { readFileSync } from "node:fs";
import { join } from "node:path";

import { enableAutoUnmount, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import AgentPanel from "./AgentPanel.vue";

const mcpVersion = (
  JSON.parse(
    // Vitest runs from this app's directory.
    readFileSync(join(process.cwd(), "../../packages/mcp/package.json"), "utf8")
  ) as { version: string }
).version;

async function openWizard() {
  const wrapper = mount(AgentPanel, { attachTo: document.body });
  await wrapper.get('[data-action="open-agent-wizard"]').trigger("click");
  return wrapper;
}

const prompt = (wrapper: ReturnType<typeof mount>) =>
  wrapper.get('[data-prompt="prompt"]').text();

enableAutoUnmount(afterEach);

describe("The agent wizard", () => {
  it("pins Ayme's MCP server to this repository's version", async () => {
    const wrapper = await openWizard();

    expect(prompt(wrapper)).toContain(`-y @ayme-dev/mcp@${mcpVersion} mcp`);
    expect(prompt(wrapper)).not.toContain("@latest");
  });

  it("tells the agent to connect this page with ayme_connect", async () => {
    const wrapper = await openWizard();

    expect(prompt(wrapper)).toContain(
      `call ayme_connect with ${window.location.origin}${window.location.pathname}`
    );
  });

  it("loads no script and opens no connection of its own", async () => {
    const scripts = document.scripts.length;
    const wrapper = await openWizard();
    await wrapper.get('[data-action="wizard-next"]').trigger("click");

    expect(document.scripts.length).toBe(scripts);
    expect(wrapper.text()).not.toMatch(/relay/i);
  });

  it("closes itself when a connect link reaches this tab, so the agent is not blocked", async () => {
    const wrapper = await openWizard();
    await wrapper.get('[data-action="wizard-next"]').trigger("click");
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);

    window.dispatchEvent(
      new HashChangeEvent("hashchange", {
        oldURL: window.location.href,
        newURL: `${window.location.href}#ayme=ws://127.0.0.1:9350/token`,
      })
    );

    await vi.waitFor(() =>
      expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    );
  });

  it("stays open on any other hash change", async () => {
    const wrapper = await openWizard();

    window.dispatchEvent(
      new HashChangeEvent("hashchange", {
        oldURL: window.location.href,
        newURL: `${window.location.href}#archived`,
      })
    );
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
  });
});
