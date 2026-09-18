import { enableAutoUnmount, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AgentPanel from "./AgentPanel.vue";

const relayScript = () =>
  document.head.querySelector<HTMLScriptElement>("script[data-ayme-relay]");

// The relay embed's internal protocol, read from @mcp-b/webmcp-local-relay
// 5.1.0. Re-verify these names whenever the pinned version changes.
function relaySays(type: string, origin = window.location.origin) {
  window.dispatchEvent(
    new MessageEvent("message", { data: { type, requestId: "1" }, origin })
  );
}

async function openWizard() {
  const wrapper = mount(AgentPanel, { attachTo: document.body });
  await wrapper.get('[data-action="open-agent-wizard"]').trigger("click");
  return wrapper;
}

async function openAt(step: 2 | 3) {
  const wrapper = await openWizard();
  for (let visited = 1; visited < step; visited += 1)
    await wrapper.get('[data-action="wizard-next"]').trigger("click");
  return wrapper;
}

async function mountConnecting() {
  const wrapper = await openAt(3);
  await wrapper.get('[data-action="connect-relay"]').trigger("click");
  return wrapper;
}

const status = (wrapper: ReturnType<typeof mount>) =>
  wrapper.get("[data-relay-status]").attributes("data-relay-status");

enableAutoUnmount(afterEach);

describe("The agent wizard", () => {
  beforeEach(() => {
    // Reka's dialog animates through requestAnimationFrame, so only the
    // component's own timers are faked here.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });

  afterEach(() => {
    vi.useRealTimers();
    relayScript()?.remove();
    document.querySelector("iframe[data-webmcp-relay]")?.remove();
  });

  it("explains the relay and loads nothing until asked", async () => {
    const wrapper = await openWizard();

    expect(wrapper.text()).toContain("runs on your computer");
    expect(status(wrapper)).toBe("idle");
    expect(relayScript()).toBeNull();
  });

  it("pins one relay version and this page's origin in the prompt", async () => {
    const wrapper = await openAt(2);

    expect(wrapper.get("pre").text()).toContain(
      `@mcp-b/webmcp-local-relay@5.1.0 --widget-origin ${window.location.origin}`
    );
  });

  it("loads the pinned relay embed when the visitor connects", async () => {
    const wrapper = await mountConnecting();

    expect(relayScript()?.src).toBe(
      "https://cdn.jsdelivr.net/npm/@mcp-b/webmcp-local-relay@5.1.0/dist/browser/embed.js"
    );
    expect(status(wrapper)).toBe("searching");
    expect(wrapper.text()).toContain("Chrome");
  });

  it("reports the connection once a relay answers and does not refuse", async () => {
    const wrapper = await mountConnecting();

    relaySays("webmcp.tools.list.request");
    await vi.advanceTimersByTimeAsync(1_000);

    expect(status(wrapper)).toBe("found");
  });

  it("ignores relay messages from another origin", async () => {
    const wrapper = await mountConnecting();

    relaySays("webmcp.tools.list.request", "https://elsewhere.example");
    await vi.advanceTimersByTimeAsync(1_000);

    expect(status(wrapper)).toBe("searching");
  });

  it("stays on the origin error while a refusing relay keeps answering", async () => {
    const wrapper = await mountConnecting();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      relaySays("webmcp.tools.list.request");
      relaySays("webmcp.relay.rejected");
      await vi.advanceTimersByTimeAsync(500);
    }
    await vi.advanceTimersByTimeAsync(1_000);

    expect(status(wrapper)).toBe("rejected");
    expect(wrapper.get('[role="alert"]').text()).toContain("refused");
  });

  it("offers a prompt that lets the agent repair a refusing relay", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const wrapper = await mountConnecting();

    relaySays("webmcp.relay.rejected");
    await wrapper.vm.$nextTick();
    await wrapper.get('[data-action="copy-fix-prompt"]').trigger("click");

    const fixPrompt = wrapper.get('[data-prompt="fix-prompt"]').text();
    expect(fixPrompt).toContain(`--widget-origin to ${window.location.origin}`);
    expect(writeText).toHaveBeenCalledWith(fixPrompt);
    vi.unstubAllGlobals();
  });

  it("names the likely causes and rescans when no relay turns up", async () => {
    const wrapper = await mountConnecting();
    const relayFrame = document.createElement("iframe");
    relayFrame.setAttribute("data-webmcp-relay", "1");
    document.body.append(relayFrame);
    const rescan = vi.spyOn(relayFrame.contentWindow!, "postMessage");

    await vi.advanceTimersByTimeAsync(20_000);
    expect(status(wrapper)).toBe("not-found");
    expect(wrapper.text()).toContain("restart");

    await wrapper.get('[data-action="retry-relay"]').trigger("click");

    expect(rescan).toHaveBeenCalledWith(
      { type: "webmcp.connect" },
      window.location.origin
    );
    expect(status(wrapper)).toBe("searching");
  });

  it("lets the visitor retry when the relay script fails to load", async () => {
    const wrapper = await mountConnecting();

    relayScript()?.dispatchEvent(new Event("error"));
    await wrapper.vm.$nextTick();

    expect(status(wrapper)).toBe("load-failed");
    expect(relayScript()).toBeNull();
    expect(
      wrapper.get('[data-action="connect-relay"]').attributes("disabled")
    ).toBeUndefined();
  });

  it("closes on Done and keeps the connection when reopened", async () => {
    const wrapper = await mountConnecting();
    const loadedScript = relayScript();

    relaySays("webmcp.tools.list.request");
    await vi.advanceTimersByTimeAsync(1_000);
    await wrapper.get('[data-action="wizard-done"]').trigger("click");

    expect(wrapper.find("[data-action=wizard-done]").exists()).toBe(false);
    expect(wrapper.get('[data-action="open-agent-wizard"]').text()).toContain(
      "Connected"
    );

    await wrapper.get('[data-action="open-agent-wizard"]').trigger("click");

    expect(status(wrapper)).toBe("found");
    expect(wrapper.text()).toContain("Paste the same prompt");
    expect(relayScript()).toBe(loadedScript);
  });

  it("leads on from the Connect step once the page is connected", async () => {
    const wrapper = await mountConnecting();
    relaySays("webmcp.tools.list.request");
    await vi.advanceTimersByTimeAsync(1_000);

    const connectStep = wrapper
      .findAll("button")
      .find((button) => button.text().endsWith("Connect"));
    // Reka's stepper trigger reacts to mousedown, not click.
    await connectStep!.trigger("mousedown", { button: 0 });

    expect(wrapper.text()).toContain("Connected to your relay.");
    expect(wrapper.find('[data-action="connect-relay"]').exists()).toBe(false);

    await wrapper.get('[data-action="wizard-next"]').trigger("click");

    expect(wrapper.text()).toContain("Paste the same prompt");
  });
});
