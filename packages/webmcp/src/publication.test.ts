import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  startWebMcpPublication,
  type WebMcpPublicationStatus,
  type WebMcpTool,
} from "./index";
import type { PublishedTool } from "./testing";

/** A driver that keeps what is registered, as `document.modelContext` would. */
function recordingDriver() {
  const tools = new Map<string, PublishedTool>();
  const registerTool = vi.fn(
    async (tool: PublishedTool, { signal }: { signal: AbortSignal }) => {
      tools.set(tool.name, tool);
      signal.addEventListener("abort", () => {
        if (tools.get(tool.name) === tool) tools.delete(tool.name);
      });
    }
  );
  return {
    registerTool,
    names: () => [...tools.keys()],
    call: (name: string, input: unknown = {}) => {
      const tool = tools.get(name);
      if (!tool) throw new Error(`${name} is not registered.`);
      return tool.execute(input);
    },
  };
}

const schema = { type: "object", properties: {} };
const tool = (
  name: string,
  description = `${name}.`,
  reading: Partial<Pick<WebMcpTool, "group" | "available">> = {}
): WebMcpTool => ({
  name,
  description,
  inputSchema: schema,
  group: "pageObject",
  available: true,
  ...reading,
});

/** An in-memory tool source; `run` calls the given implementation. */
function toolSource(initial: WebMcpTool[]) {
  let tools: readonly WebMcpTool[] = initial;
  let failure: Error | undefined;
  const listeners = new Set<() => void>();
  const source = {
    list: () => {
      if (failure) throw failure;
      return tools;
    },
    subscribe: vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    run: vi.fn(async (_name: string, input: unknown): Promise<unknown> => ({
      ran: input,
    })),
  };
  return {
    source,
    /** Changes the listed tools and tells the listeners, as a probe does. */
    set(next: WebMcpTool[]) {
      tools = next;
      for (const listener of listeners) listener();
    },
    fail(error: Error | undefined) {
      failure = error;
      for (const listener of listeners) listener();
    },
    listeners,
  };
}

/** Lets the publication's promise chains run. */
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe("startWebMcpPublication", () => {
  let driver: ReturnType<typeof recordingDriver>;
  let controller: AbortController;
  let statuses: WebMcpPublicationStatus[];

  beforeEach(() => {
    driver = recordingDriver();
    controller = new AbortController();
    statuses = [];
    vi.stubGlobal("document", { modelContext: driver });
  });

  afterEach(() => {
    controller.abort();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function publish(
    source: ReturnType<typeof toolSource>["source"],
    toolNamePrefix?: string
  ) {
    return startWebMcpPublication(source, {
      toolNamePrefix,
      signal: controller.signal,
      onStatus: (status) => statuses.push(status),
    });
  }

  it("publishes the source's tools and reports itself active", async () => {
    const { source } = toolSource([tool("snapshot"), tool("Todo.add")]);

    await publish(source).retry();

    expect(driver.names()).toEqual(["snapshot", "Todo.add"]);
    expect(statuses.map(({ state }) => state)).toEqual(["waiting", "active"]);
    expect(statuses.at(-1)?.message).toBe(
      "Registered 2 WebMCP tools and watching for changes."
    );
    expect(Object.isFrozen(statuses.at(-1))).toBe(true);
  });

  it("registers each tool under toolNamePrefix and calls it by its own name", async () => {
    const { source } = toolSource([tool("Todo.add")]);

    await publish(source, "app_").retry();

    expect(driver.names()).toEqual(["app_Todo.add"]);
    await driver.call("app_Todo.add", { title: "Milk" });
    expect(source.run).toHaveBeenCalledExactlyOnceWith("Todo.add", {
      title: "Milk",
    });
  });

  it("publishes the available tools, but Peek Tools and screenshot", async () => {
    const tools = toolSource([
      tool("snapshot", undefined, { group: "agent" }),
      tool("screenshot", undefined, { group: "browser" }),
      tool("peek.cart", undefined, { group: "peek" }),
      tool("Dialog.close", undefined, { available: false }),
    ]);
    await publish(tools.source).retry();

    expect(driver.names()).toEqual(["snapshot"]);

    tools.set([
      tool("snapshot", undefined, { group: "agent" }),
      tool("Dialog.close"),
    ]);
    await flush();
    expect(driver.names()).toEqual(["snapshot", "Dialog.close"]);
  });

  it("follows the source: withdraws what it stops listing and registers what it adds", async () => {
    const tools = toolSource([tool("snapshot"), tool("Todo.add")]);
    await publish(tools.source).retry();

    tools.set([tool("snapshot"), tool("Todo.remove")]);
    await flush();

    expect(driver.names()).toEqual(["snapshot", "Todo.remove"]);
  });

  it("registers a tool again when its description or schema changes", async () => {
    const tools = toolSource([tool("Todo.add")]);
    await publish(tools.source).retry();

    tools.set([tool("Todo.add")]);
    await flush();
    expect(driver.registerTool).toHaveBeenCalledOnce();

    tools.set([tool("Todo.add", "Add a todo.")]);
    await flush();
    expect(driver.registerTool).toHaveBeenCalledTimes(2);
    expect(driver.names()).toEqual(["Todo.add"]);
  });

  it.each([
    ["succeeds", async () => "opened", "opened"],
    [
      "fails",
      async () => {
        throw new Error("Not opened.");
      },
      { content: [{ type: "text", text: "Not opened." }], isError: true },
    ],
  ])(
    "resolves a call that %s only once the tools it changed are published",
    async (_, outcome, result) => {
      const tools = toolSource([tool("Todo.open")]);
      let release!: () => void;
      // Registering Todo.close waits until the test releases it.
      const registered = new Map<string, PublishedTool>();
      driver.registerTool.mockImplementation(async (tool, { signal }) => {
        if (tool.name === "Todo.close")
          await new Promise<void>((resolve) => (release = resolve));
        registered.set(tool.name, tool);
        signal.addEventListener("abort", () => registered.delete(tool.name));
      });
      tools.source.run.mockImplementation(async () => {
        tools.set([tool("Todo.open"), tool("Todo.close")]);
        return await outcome();
      });
      await publish(tools.source).retry();

      let resolved = false;
      const call = registered
        .get("Todo.open")!
        .execute({})
        .then((result) => {
          resolved = true;
          return result;
        });
      await flush();
      expect(resolved).toBe(false);

      release();
      expect(await call).toEqual(result);
      expect([...registered.keys()]).toEqual(["Todo.open", "Todo.close"]);
    }
  );

  it("keeps a tool its own call made unavailable until the call returns, then withdraws it", async () => {
    vi.useFakeTimers();
    const tools = toolSource([tool("Dialog.close")]);
    tools.source.run.mockImplementation(async () => {
      tools.set([]);
      await flush();
      // Still registered while its call runs.
      expect(driver.names()).toEqual(["Dialog.close"]);
      return "closed";
    });
    await publish(tools.source).retry();

    expect(await driver.call("Dialog.close")).toBe("closed");
    expect(driver.names()).toEqual(["Dialog.close"]);
    await vi.runAllTimersAsync();
    expect(driver.names()).toEqual([]);
  });

  it("returns a failing call as an isError result with the error's text", async () => {
    const tools = toolSource([tool("click")]);
    await publish(tools.source).retry();
    class RefResolutionError extends Error {
      override name = "RefResolutionError";
    }
    const failure = (text: string) => ({
      content: [{ type: "text", text }],
      isError: true,
    });

    tools.source.run.mockRejectedValueOnce(
      new RefResolutionError("e3 no longer matches.")
    );
    expect(await driver.call("click")).toEqual(
      failure("RefResolutionError: e3 no longer matches.")
    );
    tools.source.run.mockRejectedValueOnce(new Error("Timeout 1000ms."));
    expect(await driver.call("click")).toEqual(failure("Timeout 1000ms."));
    tools.source.run.mockRejectedValueOnce("plain");
    expect(await driver.call("click")).toEqual(failure("plain"));
  });

  it("reports unavailable when no driver appears, and publishes on a retry once one has", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("document", {});
    const { source } = toolSource([tool("snapshot")]);
    const publication = publish(source);

    await vi.advanceTimersByTimeAsync(2_100);
    expect(statuses.map(({ state }) => state)).toEqual([
      "waiting",
      "unavailable",
    ]);

    vi.stubGlobal("document", { modelContext: driver });
    await publication.retry();
    expect(statuses.at(-1)?.state).toBe("active");
    expect(driver.names()).toEqual(["snapshot"]);
  });

  it("reports a source that cannot list as failed, and publishes on a retry once it can", async () => {
    const tools = toolSource([tool("click")]);
    tools.fail(new Error("The tools cannot be listed."));
    const publication = publish(tools.source);
    await publication.retry();

    expect(statuses.at(-1)).toEqual({
      state: "failed",
      message: "WebMCP publication failed: The tools cannot be listed.",
    });
    expect(driver.names()).toEqual([]);

    tools.fail(undefined);
    await publication.retry();
    expect(statuses.at(-1)?.state).toBe("active");
    expect(driver.names()).toEqual(["click"]);
  });

  it("fails and withdraws every tool when a later pass cannot list", async () => {
    const tools = toolSource([tool("snapshot")]);
    await publish(tools.source).retry();

    tools.fail(new Error("Not listed."));
    await flush();

    expect(statuses.at(-1)).toEqual({
      state: "failed",
      message: "WebMCP publication failed: Not listed.",
    });
    expect(driver.names()).toEqual([]);
    expect(tools.listeners.size).toBe(0);
  });

  it("withdraws what it registered when a registration fails", async () => {
    const { source } = toolSource([tool("snapshot"), tool("click")]);
    const registered = new Set<string>();
    driver.registerTool.mockImplementation(async ({ name }, { signal }) => {
      if (name === "click") throw new Error("registration refused");
      registered.add(name);
      signal.addEventListener("abort", () => registered.delete(name));
    });

    await publish(source).retry();

    expect(statuses.at(-1)?.message).toBe(
      "WebMCP publication failed: registration refused"
    );
    expect([...registered]).toEqual([]);
  });

  it("shares one attempt between retries, and does nothing while active", async () => {
    const { source } = toolSource([tool("snapshot")]);
    const publication = publish(source);

    const attempt = publication.retry();
    expect(publication.retry()).toBe(attempt);
    await attempt;
    await publication.retry();

    expect(driver.registerTool).toHaveBeenCalledOnce();
    expect(statuses.map(({ state }) => state)).toEqual(["waiting", "active"]);
  });

  it("withdraws every tool when the signal aborts, and reports nothing after", async () => {
    const tools = toolSource([tool("snapshot")]);
    await publish(tools.source).retry();

    controller.abort();
    tools.set([tool("snapshot"), tool("click")]);
    await flush();

    expect(driver.names()).toEqual([]);
    expect(statuses.map(({ state }) => state)).toEqual(["waiting", "active"]);
  });

  it("publishes nothing when the signal aborts while it waits for the driver", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("document", {});
    const { source } = toolSource([tool("snapshot")]);
    const attempt = publish(source).retry();

    controller.abort();
    expect(vi.getTimerCount()).toBe(0);
    vi.stubGlobal("document", { modelContext: driver });
    await vi.advanceTimersByTimeAsync(2_100);
    await attempt;

    expect(driver.registerTool).not.toHaveBeenCalled();
    expect(statuses.map(({ state }) => state)).toEqual(["waiting"]);
  });
});
