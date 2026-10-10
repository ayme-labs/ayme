import { expect, it, vi } from "vitest";

import {
  AgentConnection,
  type ChannelSession,
} from "../application/agentConnection";
import { pageChannelRouter } from "./pageChannelRouter";

it("hands a page's hello, tools and answers to the server", async () => {
  const session: Pick<ChannelSession, "publishTools" | "answer"> = {
    publishTools: vi.fn(),
    answer: vi.fn(),
  };
  const hello = vi.fn(() => ({ token: "f00d" }));
  const caller = pageChannelRouter.createCaller({
    connection: new AgentConnection(),
    page: {
      hello,
      session: Promise.resolve(session as ChannelSession),
    },
  });
  const tool = {
    name: "peek",
    description: "",
    inputSchema: {},
    available: true,
  };
  const outcome = { callId: "1", ok: true as const, result: "done" };

  expect(
    await caller.hello({ tab: "a", url: "http://localhost:5173/" })
  ).toEqual({ token: "f00d" });
  await caller.publishTools([tool]);
  await caller.answer(outcome);

  expect(hello).toHaveBeenCalledWith({
    tab: "a",
    url: "http://localhost:5173/",
  });
  expect(session.publishTools).toHaveBeenCalledWith([tool]);
  expect(session.answer).toHaveBeenCalledWith(outcome);
});
