// @vitest-environment jsdom
import { effectScope } from "vue";
import { afterEach, expect, it, vi } from "vitest";

import {
  createPageRegistration,
  registerCompiledPom,
  type WebMcpDriver,
} from "@ayme-dev/webmcp/internal";
import { useAymeWebMcp, type UseAymeWebMcpOptions } from "./index";

class FakeMutationObserver {
  observe() {}
  disconnect() {}
}

async function flushPromises() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

afterEach(() => {
  vi.unstubAllGlobals();
});

it("keeps a real publisher startup failure retryable", async () => {
  vi.stubGlobal("__AYME_WEBMCP_PUBLISH__", true);
  vi.stubGlobal("MutationObserver", FakeMutationObserver);

  let resolveInitialRegistration = () => {};
  let failRegistration = true;
  const registerTool = vi.fn(() => {
    if (registerTool.mock.calls.length === 1)
      return new Promise<void>((resolve) => {
        resolveInitialRegistration = resolve;
      });
    if (failRegistration) throw new Error("synchronous registration failed");
  });
  vi.stubGlobal("document", {
    documentElement: {},
    modelContext: { registerTool } as unknown as WebMcpDriver,
  });

  class IntegrationPage {
    run() {}
  }
  registerCompiledPom(IntegrationPage, {
    className: "IntegrationPage",
    components: [],
    members: [],
    tools: [
      {
        methodName: "run",
        toolName: "run",
        description: "Run",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false,
        },
        parameters: [],
      },
    ],
  });

  const scope = effectScope();
  const result = scope.run(() =>
    useAymeWebMcp({
      page: () => ({}) as ReturnType<NonNullable<UseAymeWebMcpOptions["page"]>>,
    })
  );
  await flushPromises();

  resolveInitialRegistration();
  queueMicrotask(() => createPageRegistration(IntegrationPage));
  await flushPromises();

  expect(result?.publicationStatus.value).toEqual({
    state: "failed",
    message: "WebMCP publication failed: synchronous registration failed",
  });

  failRegistration = false;
  await result?.retryPublication();
  expect(result?.publicationStatus.value.state).toBe("active");

  scope.stop();
});
