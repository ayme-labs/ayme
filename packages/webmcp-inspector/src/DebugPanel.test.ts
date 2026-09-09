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
    const inactiveExecute = vi.fn(async () => ({ ok: true as const }));
    const activeExecute = vi.fn(async () => ({ ok: true as const }));
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
});
