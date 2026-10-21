import { enableAutoUnmount, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "./App.vue";

// Only App.vue's own template and its useAyme options are under test, so Ayme
// and the playground itself are stubbed out.
const useAyme = vi.hoisted(() =>
  vi.fn(() => ({ ayme: { runs: { subscribe: () => () => {} } } }))
);
vi.mock("@ayme-dev/vue", () => ({ useAyme }));
const stubs = { ListDemo: true, PeekCheck: true };

enableAutoUnmount(afterEach);
afterEach(() => {
  vi.unstubAllEnvs();
  useAyme.mockClear();
});

const wizard = '[data-action="open-agent-wizard"]';

describe("The playground's agent connection flag", () => {
  it("offers the agent wizard and the Agent Connection by default", () => {
    const wrapper = mount(App, { global: { stubs } });

    expect(wrapper.find(wizard).exists()).toBe(true);
    expect(useAyme).toHaveBeenCalledWith(
      expect.objectContaining({ agentConnection: true })
    );
  });

  it("leaves both out when VITE_AGENT_CONNECTION is false", () => {
    vi.stubEnv("VITE_AGENT_CONNECTION", "false");
    const wrapper = mount(App, { global: { stubs } });

    expect(wrapper.find(wizard).exists()).toBe(false);
    expect(wrapper.text()).not.toMatch(/coding agent/);
    expect(useAyme).toHaveBeenCalledWith(
      expect.objectContaining({ agentConnection: false })
    );
  });
});
