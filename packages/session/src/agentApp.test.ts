import { expect, it } from "vitest";

import { startScriptedSession } from "../testing";

// The Inspector an Agent App shows in its chat, and a Run started from any
// Inspector, through the Session's interface on the scripted browser.

const WINDOW = "http://127.0.0.1:4444/inspector";
const SOCKET = "ws://127.0.0.1:4444/inspector/ws?token=secret";

it("ayme mcp is answered with the socket an Agent App's view connects to, and a sentence that holds no token", async () => {
  const { session } = await startScriptedSession({
    open: { headed: false },
    name: "shop",
    inspector: WINDOW,
    agentApp: SOCKET,
  });

  expect(await session.ask({ inspector: { agentApp: {} } })).toEqual({
    ok: true,
    text: "The Inspector of the Session shop shows in this chat when your Agent App shows MCP Apps. ayme -s=shop inspect opens it in a browser window.",
    data: { socket: SOCKET },
  });
});

it("a Session served without a window says so to ayme mcp", async () => {
  const { session } = await startScriptedSession({ open: { headed: false } });

  expect(await session.ask({ inspector: { agentApp: {} } })).toEqual({
    ok: false,
    text: "This Session serves no Inspector window.",
  });
});

it("a Run started from an Inspector has the Inspector as its Caller, whatever Caller the window names", async () => {
  const { session, browser } = await startScriptedSession({
    open: { headed: false },
    inspector: WINDOW,
  });

  await session.ask({
    inspector: {
      contract: {
        method: "runTool",
        params: { name: "Basket.add", input: {}, by: "ayme-command" },
      },
    },
  });
  await session.ask({
    inspector: { contract: { method: "runTool", params: "not an object" } },
  });

  expect(browser.inspectorCalls).toEqual([
    {
      method: "runTool",
      params: { name: "Basket.add", input: {}, by: "inspector" },
    },
    { method: "runTool", params: { by: "inspector" } },
  ]);
});
