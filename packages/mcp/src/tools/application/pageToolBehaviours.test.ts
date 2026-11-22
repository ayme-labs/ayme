import { expect, it, vi } from "vitest";

import type { PageChannel, PageTools } from "../../connection";
import type { PageTool, ToolCall, ToolCallOutcome } from "../../contract";
import { answerToolCalls, publishPageTools } from "./pageToolBehaviours";

it("answers a call with its tool's result", async () => {
  let handler!: (call: ToolCall) => Promise<ToolCallOutcome>;
  const channel = {
    answerCalls(answerWith: typeof handler) {
      handler = answerWith;
      return () => {};
    },
  } as unknown as PageChannel;
  const run = vi.fn(async () => ({ settled: true }));
  answerToolCalls({ tools: { run } as unknown as PageTools, channel });

  expect(
    await handler({ callId: "1", name: "Dialog.confirm", input: { a: 1 } })
  ).toEqual({ callId: "1", ok: true, result: { settled: true } });
  expect(run).toHaveBeenCalledWith("Dialog.confirm", { a: 1 });
});

it("answers a failed call with the error's text and the Change Record it carries", async () => {
  let handler!: (call: ToolCall) => Promise<ToolCallOutcome>;
  const channel = {
    answerCalls(answerWith: typeof handler) {
      handler = answerWith;
      return () => {};
    },
  } as unknown as PageChannel;
  const failure = Object.assign(new Error("Timeout 1000ms."), {
    name: "TimeoutError",
    page_changed: true,
    changes: "- e3 status: Saved",
  });
  const tools = {
    run: vi.fn(async () => {
      throw failure;
    }),
  } as unknown as PageTools;
  answerToolCalls({ tools, channel });

  expect(await handler({ callId: "1", name: "click", input: {} })).toEqual({
    callId: "1",
    ok: false,
    error: "TimeoutError: Timeout 1000ms.\n\nchanges:\n- e3 status: Saved",
  });
});

it("publishes every tool of the page with its availability, reason and group, again after each change", () => {
  const published: PageTool[][] = [];
  const channel = {
    publishTools: async (tools: PageTool[]) => void published.push(tools),
  } as unknown as PageChannel;
  const tool = (name: string, available: boolean, reason?: string) => ({
    name,
    description: "",
    inputSchema: {},
    group: name === "snapshot" ? "agent" : "pageObject",
    className: "Dialog",
    available,
    ...(reason === undefined ? {} : { reason }),
  });
  let announce!: (tools: ReturnType<PageTools["list"]>) => void;
  const tools = {
    list: () => [
      tool("snapshot", true),
      tool("Dialog.confirm", false, "a click would not reach it"),
    ],
    subscribe: (listener: typeof announce) => {
      announce = listener;
      return () => {};
    },
  } as unknown as PageTools;

  publishPageTools({ tools, channel });
  announce([tool("snapshot", true), tool("Dialog.confirm", true)]);

  const expected = (name: string, available: boolean, reason?: string) => ({
    name,
    description: "",
    inputSchema: {},
    available,
    group: name === "snapshot" ? "agent" : "pageObject",
    ...(reason === undefined ? {} : { reason }),
  });
  expect(published).toEqual([
    [
      expected("snapshot", true),
      expected("Dialog.confirm", false, "a click would not reach it"),
    ],
    [expected("snapshot", true), expected("Dialog.confirm", true)],
  ]);
});

it("publishes the page's tools with each one's destructive mark, and no mark on the others", () => {
  const published: PageTool[][] = [];
  const channel = {
    publishTools: vi.fn(async (tools: PageTool[]) => {
      published.push(tools);
    }),
  } as unknown as PageChannel;
  const page = (name: string, destructive?: boolean): PageTool => ({
    name,
    inputSchema: {},
    available: true,
    ...(destructive === undefined ? {} : { destructive }),
  });
  const tools = {
    list: () => [
      page("Order.submit", true),
      page("Order.preview", false),
      page("Order.edit"),
    ],
    subscribe: () => () => {},
  } as unknown as PageTools;

  publishPageTools({ tools, channel });

  expect(
    published[0]?.map(({ name, destructive }) => [name, destructive])
  ).toEqual([
    ["Order.submit", true],
    ["Order.preview", undefined],
    ["Order.edit", undefined],
  ]);
  expect(published[0]?.[1]).not.toHaveProperty("destructive");
});
