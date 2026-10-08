import { expect, it, vi } from "vitest";

import type { AgentImageRun, PageChannel, PageTools } from "../../connection";
import type { ToolCall, ToolCallOutcome } from "../../contract";
import { answerToolCalls, publishPageTools } from "./pageToolBehaviours";

const image = {
  type: "image",
  subject: "the viewport",
  filename: "shot.png",
  mimeType: "image/png",
  width: 10,
  height: 10,
  data: "iVBORw0KGgo=",
};

/** Answers one call through `answerToolCalls`, with the page's tool returning `result`. */
async function answer(
  result: unknown,
  imageFolder: string | undefined
): Promise<{ outcome: ToolCallOutcome; recorded: AgentImageRun[] }> {
  let handler!: (call: ToolCall) => Promise<ToolCallOutcome>;
  const channel = {
    imageFolder,
    answerCalls(answerWith: typeof handler) {
      handler = answerWith;
      return () => {};
    },
  } as unknown as PageChannel;
  const tools = { run: vi.fn(async () => result) } as unknown as PageTools;
  const recorded: AgentImageRun[] = [];
  answerToolCalls({
    tools,
    channel,
    recordAgentImage: (run) => recorded.push(run),
  });
  const outcome = await handler({
    callId: "1",
    name: "screenshot",
    input: { fullPage: true },
  });
  return { outcome, recorded };
}

it("records an agent's image with the file the server saves it to", async () => {
  const { outcome, recorded } = await answer(image, "/tmp/ayme-screenshots/");

  expect(outcome).toEqual({ callId: "1", ok: true, result: image });
  expect(recorded).toEqual([
    {
      name: "screenshot",
      input: { fullPage: true },
      result: image,
      savedTo: "/tmp/ayme-screenshots/shot.png",
      startedAt: expect.any(Number),
      durationMs: expect.any(Number),
    },
  ]);
});

it("records an image without a file when the server named no folder", async () => {
  const { recorded } = await answer(image, undefined);

  expect(recorded[0]?.savedTo).toBeUndefined();
});

it("records no other result", async () => {
  const { recorded } = await answer({ page_changed: false }, "/tmp/x/");

  expect(recorded).toEqual([]);
});

it("publishes only the page's available tools, again after each change", () => {
  const published: string[][] = [];
  const channel = {
    publishTools: async (tools: { name: string }[]) =>
      void published.push(tools.map(({ name }) => name)),
  } as unknown as PageChannel;
  const tool = (name: string, available: boolean) => ({
    name,
    description: "",
    inputSchema: {},
    available,
  });
  let announce!: (tools: ReturnType<PageTools["list"]>) => void;
  const tools = {
    list: () => [tool("snapshot", true), tool("Dialog.confirm", false)],
    subscribe: (listener: typeof announce) => {
      announce = listener;
      return () => {};
    },
  } as unknown as PageTools;

  publishPageTools({ tools, channel });
  announce([tool("snapshot", true), tool("Dialog.confirm", true)]);

  expect(published).toEqual([["snapshot"], ["snapshot", "Dialog.confirm"]]);
});
