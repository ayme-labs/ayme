import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";

import DebugPanel from "./DebugPanel.vue";
import type { RegisteredPomTool } from "@ayme-dev/webmcp";
import {
  listRegisteredPomTools,
  type RegisteredPom,
} from "@ayme-dev/webmcp/internal";

vi.mock("@ayme-dev/webmcp/internal", () => ({
  listRegisteredPomTools: vi.fn(),
}));

function tool(pomId: string, execute: RegisteredPomTool["execute"]) {
  return {
    pomId,
    methodName: "save",
    name: "Editor.save",
    description: "Save the editor.",
    inputSchema: { type: "object" as const },
    parameters: [],
    execute,
  } satisfies RegisteredPomTool;
}

function registration(id: string, registeredTool: RegisteredPomTool) {
  return {
    id,
    instance: {},
    manifest: { className: "Editor", members: [], components: [], tools: [] },
    memberObservations: [],
    tools: [registeredTool],
  } satisfies RegisteredPom;
}

describe("DebugPanel", () => {
  it("invokes the active registration when tool names collide", async () => {
    const inactiveExecute = vi.fn(async () => ({
      page_changed: false,
      settled: true,
    }));
    const activeExecute = vi.fn(async () => ({
      page_changed: false,
      settled: true,
    }));
    const inactiveTool = tool("inactive", inactiveExecute);
    const activeTool = tool("active", activeExecute);
    vi.mocked(listRegisteredPomTools).mockReturnValue([activeTool]);

    const wrapper = mount(DebugPanel, {
      props: {
        pageState: undefined,
        pageStateCapturedAt: undefined,
        pageStateError: undefined,
        pageStateLoading: false,
        applicationModelSelectionPath: undefined,
        refreshPageState: async () => {},
        registeredPoms: [
          registration("inactive", inactiveTool),
          registration("active", activeTool),
        ],
        refreshPomMembers: async () => {},
        resetTrace: () => {},
        trace: [],
        webMcpStatus: "ready",
        previewApplicationModelTarget: () => {},
        clearApplicationModelPreview: () => {},
        pinApplicationModelTarget: () => {},
      },
    });

    await wrapper.get("form.tool-form").trigger("submit");

    expect(activeExecute).toHaveBeenCalledOnce();
    expect(inactiveExecute).not.toHaveBeenCalled();
  });

  it("collapses to an Ayme logo FAB and restores the panel", async () => {
    const wrapper = mount(DebugPanel, {
      props: {
        pageState: undefined,
        pageStateCapturedAt: undefined,
        pageStateError: undefined,
        pageStateLoading: false,
        applicationModelSelectionPath: undefined,
        refreshPageState: async () => {},
        registeredPoms: [],
        refreshPomMembers: async () => {},
        resetTrace: () => {},
        trace: [],
        webMcpStatus: "ready",
        previewApplicationModelTarget: () => {},
        clearApplicationModelPreview: () => {},
        pinApplicationModelTarget: () => {},
      },
    });

    await wrapper
      .get('button[aria-label="Collapse inspector"]')
      .trigger("click");

    expect(
      wrapper.find('aside[aria-label="Ayme debug utilities"]').exists()
    ).toBe(false);
    const fab = wrapper.get('button[aria-label="Open Ayme POM inspector"]');
    expect(fab.get("svg").attributes("viewBox")).toBe("0 0 165.84 136");
    expect(fab.get("svg path").attributes("fill")).toBe("#6936F1");
    expect(fab.get("svg path").attributes("d")).toContain("M120.57 131.59");

    await fab.trigger("click");

    expect(
      wrapper.get('aside[aria-label="Ayme debug utilities"]')
    ).toBeTruthy();
  });
});
