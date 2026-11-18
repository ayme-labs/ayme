import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  PROTOCOL_VERSION_META_KEY,
  type JSONRPCMessage,
} from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { afterEach, describe, expect, it } from "vitest";

import { AgentConnection } from "../../connection";
import type { PageTool } from "../../contract";
import { callTool } from "../application/callTool";
import { connectTool } from "../application/connectTool";
import { listToolsTool } from "../application/listToolsTool";
import { textResult } from "../domain/toolResult";
import { createMcpToolServer } from "./mcpToolServer";

/** The revision that opens with `initialize`, which the SDK client opens with by default. */
const OLDER = "2025-11-25";
/** The revision whose requests each carry it in their `_meta`. */
const MODERN = "2026-07-28";
const REVISIONS = [OLDER, MODERN] as const;
type Revision = (typeof REVISIONS)[number];

const tool = (
  name: string,
  reading: Partial<Pick<PageTool, "available" | "reason">> = {}
): PageTool => ({
  name,
  description: `${name}.`,
  inputSchema: { properties: {} },
  available: true,
  ...reading,
});

/** Lets a notification cross the in-memory transport. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

/**
 * A paired page's connection and the process's side of MCP: `serveStdio`
 * over memory, building each server object the way `ayme mcp` does.
 * `listening()` counts the server objects' subscriptions to the connection.
 */
function serveProcess() {
  const connection = new AgentConnection();
  const page = connection.attach({ tab: "a", url: "http://x/" }, () => {})!;
  let listening = 0;
  const subscribe = connection.subscribe.bind(connection);
  connection.subscribe = (listener) => {
    listening++;
    const unsubscribe = subscribe(listener);
    return () => {
      listening--;
      unsubscribe();
    };
  };
  const agentNames: string[] = [];
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const served = serveStdio(
    () =>
      createMcpToolServer({
        name: "ayme",
        version: "0.0.0",
        serverTools: [
          connectTool,
          listToolsTool,
          callTool,
          () => ({
            name: "ayme_noop",
            description: "Does nothing.",
            inputSchema: { type: "object" },
            call: async () => textResult("ok"),
          }),
        ],
        context: {
          connection,
          pairing: { address: "ws://x", token: "t" },
          saveImage: async () => "/x",
          failedPageObjects: async () => undefined,
          inspector: {
            url: "http://x/inspector",
            installed: async () => true,
            appPage: async () => "<!doctype html>",
            socketOrigin: "ws://x",
          },
        },
        agentNamed: (name) => agentNames.push(name),
      }),
    { transport: serverTransport }
  );
  closers.push(() => served.close());
  const publish = async (tools: PageTool[]) => {
    page.publishTools(tools);
    await settle();
  };
  return {
    clientTransport,
    publish,
    listening: () => listening,
    agentName: () => agentNames.at(-1),
  };
}

/**
 * A server with a paired page, and an agent connected to it over memory
 * with `revision`; under 2026-07-28 it listens for tool list changes unless
 * `listen` is false.
 */
async function connectAgent(
  revision: Revision = OLDER,
  { listen = true }: { listen?: boolean } = {}
) {
  const process = serveProcess();
  const client = new Client(
    { name: "test", version: "0.0.0" },
    revision === MODERN
      ? { versionNegotiation: { mode: { pin: MODERN } } }
      : undefined
  );
  let listChanges = 0;
  client.setNotificationHandler(
    "notifications/tools/list_changed",
    () => void listChanges++
  );
  await client.connect(process.clientTransport);
  closers.push(() => client.close());
  const listenForToolChanges = () => client.listen({ toolsListChanged: true });
  if (revision === MODERN && listen) await listenForToolChanges();
  /** The result's text items and whether it is an error; no `input` leaves out the arguments. */
  const answer = async (name: string, input?: Record<string, unknown>) => {
    const result = (await client.callTool({ name, arguments: input })) as {
      content: { type: string; text?: string }[];
      isError?: boolean;
    };
    return {
      texts: result.content.map(({ text }) => text),
      isError: result.isError ?? false,
    };
  };
  const call = async (name: string) => (await answer(name, {})).texts;
  return {
    ...process,
    client,
    call,
    answer,
    listChanges: () => listChanges,
    listenForToolChanges,
  };
}

describe.each(REVISIONS)("under revision %s", (revision) => {
  it("announces a changed tool list on presence only, and lists an unavailable tool without its availability", async () => {
    const agent = await connectAgent(revision);

    await agent.publish([tool("Panel.remove")]);
    expect(agent.listChanges()).toBe(1);

    await agent.publish([
      tool("Panel.remove", { available: false, reason: "No item is selected" }),
    ]);
    expect(agent.listChanges()).toBe(1);
    expect((await agent.client.listTools()).tools).toContainEqual({
      name: "Panel.remove",
      description: "Panel.remove.",
      inputSchema: { properties: {}, type: "object" },
    });

    await agent.publish([]);
    expect(agent.listChanges()).toBe(2);
  });

  it("notes the tools that became available or unavailable, and ayme_list_tools carries each tool's availability and reason", async () => {
    const agent = await connectAgent(revision);
    await agent.publish([tool("Panel.remove"), tool("Panel.copy")]);
    // An agent that never read the tool list has seen no tools.
    const [, appeared] = await agent.call("ayme_noop");
    expect(appeared).toBe(
      "The connected tools changed since your previous call. Appeared: Panel.remove, Panel.copy. ayme_list_tools lists the current tools; ayme_call runs any of them."
    );

    await agent.publish([
      tool("Panel.remove", { available: false, reason: "No item is selected" }),
      tool("Panel.copy"),
    ]);
    const [result, note] = await agent.call("ayme_noop");
    expect(result).toBe("ok");
    expect(note).toContain(
      "Became unavailable: Panel.remove (No item is selected)."
    );

    await agent.publish([tool("Panel.remove"), tool("Panel.copy")]);
    const [listing, becameAvailable] = await agent.call("ayme_list_tools");
    expect(JSON.parse(listing!)).toEqual([
      {
        name: "Panel.remove",
        description: "Panel.remove.",
        inputSchema: { properties: {}, type: "object" },
        available: true,
      },
      {
        name: "Panel.copy",
        description: "Panel.copy.",
        inputSchema: { properties: {}, type: "object" },
        available: true,
      },
    ]);
    expect(becameAvailable).toContain("Became available: Panel.remove.");

    await agent.publish([
      tool("Panel.remove", { available: false, reason: "No item is selected" }),
      tool("Panel.copy"),
    ]);
    const [unavailableListing] = await agent.call("ayme_list_tools");
    expect(JSON.parse(unavailableListing!)[0]).toMatchObject({
      name: "Panel.remove",
      available: false,
      reason: "No item is selected",
    });
  });

  it("counts the tools the tool list served as seen, so a result notes only what changed after it", async () => {
    const agent = await connectAgent(revision);
    await agent.publish([tool("Panel.remove"), tool("Panel.copy")]);
    await agent.client.listTools();
    expect(await agent.call("ayme_noop")).toEqual(["ok"]);

    await agent.publish([
      tool("Panel.remove"),
      tool("Panel.copy"),
      tool("Panel.paste"),
    ]);
    await agent.client.listTools();
    await agent.publish([
      tool("Panel.remove"),
      tool("Panel.copy"),
      tool("Panel.paste"),
      tool("Panel.cut"),
    ]);
    const [, note] = await agent.call("ayme_noop");
    expect(note).toBe(
      "The connected tools changed since your previous call. Appeared: Panel.cut. ayme_list_tools lists the current tools; ayme_call runs any of them."
    );
  });

  it("counts the parameters and description the tool list served as seen, and notes a later change to them", async () => {
    const agent = await connectAgent(revision);
    await agent.publish([tool("SurveyListPage.search")]);
    await agent.client.listTools();
    expect(await agent.call("ayme_noop")).toEqual(["ok"]);

    await agent.publish([
      {
        ...tool("SurveyListPage.search"),
        inputSchema: { properties: { text: { type: "string" } } },
      },
    ]);
    const [, note] = await agent.call("ayme_noop");
    expect(note).toContain("Changed: SurveyListPage.search (parameters).");
  });

  it("still notes the availability the tool list leaves out, once", async () => {
    const agent = await connectAgent(revision);
    await agent.publish([
      tool("Panel.remove", { available: false, reason: "No item is selected" }),
    ]);
    await agent.client.listTools();
    const [, note] = await agent.call("ayme_noop");
    expect(note).toContain(
      "Became unavailable: Panel.remove (No item is selected)."
    );

    await agent.client.listTools();
    expect(await agent.call("ayme_noop")).toEqual(["ok"]);
  });

  it("names the agent from its tools/list and tools/call", async () => {
    const agent = await connectAgent(revision);

    await agent.client.listTools();
    expect(agent.agentName()).toBe("test");
    await agent.call("ayme_noop");
    expect(agent.agentName()).toBe("test");
  });
});

it("names an agent of an older revision from its opening handshake", async () => {
  const agent = await connectAgent(OLDER);

  expect(agent.agentName()).toBe("test");
});

it("names an agent of 2026-07-28 from its requests only, which carry the name", async () => {
  const agent = await connectAgent(MODERN);
  expect(agent.agentName()).toBeUndefined();

  await agent.call("ayme_noop");
  expect(agent.agentName()).toBe("test");
});

it("under 2026-07-28, announces a changed tool list only to an agent that listens for it", async () => {
  const agent = await connectAgent(MODERN, { listen: false });

  await agent.publish([tool("Panel.remove")]);
  expect(agent.listChanges()).toBe(0);

  await agent.listenForToolChanges();
  await agent.publish([]);
  expect(agent.listChanges()).toBe(1);
});

it("stops a server object's listening when it closes, and serves on with the next one: server/discover, then initialize", async () => {
  const process = serveProcess();
  const messages: JSONRPCMessage[] = [];
  process.clientTransport.onmessage = (message) => void messages.push(message);
  await process.clientTransport.start();
  const clientInfo = { name: "prober", version: "0.0.0" };
  const reply = async (id: number) => {
    await expect
      .poll(() =>
        messages.find((message) => "id" in message && message.id === id)
      )
      .toBeDefined();
    return messages.find((message) => "id" in message && message.id === id)!;
  };

  await process.clientTransport.send({
    jsonrpc: "2.0",
    id: 1,
    method: "server/discover",
    params: {
      _meta: {
        [PROTOCOL_VERSION_META_KEY]: MODERN,
        [CLIENT_INFO_META_KEY]: clientInfo,
        [CLIENT_CAPABILITIES_META_KEY]: {},
      },
    },
  });
  expect(await reply(1)).toHaveProperty("result");
  await process.clientTransport.send({
    jsonrpc: "2.0",
    id: 2,
    method: "initialize",
    params: { protocolVersion: OLDER, capabilities: {}, clientInfo },
  });
  expect(await reply(2)).toHaveProperty("result.protocolVersion", OLDER);
  await process.clientTransport.send({
    jsonrpc: "2.0",
    method: "notifications/initialized",
  });

  expect(process.listening()).toBe(1);
  await process.publish([tool("Panel.remove")]);
  expect(
    messages.filter(
      (message) =>
        "method" in message &&
        message.method === "notifications/tools/list_changed"
    )
  ).toHaveLength(1);
  await process.clientTransport.send({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/list",
  });
  expect(await reply(3)).toHaveProperty("result.tools");
  expect(process.agentName()).toBe("prober");
});

it("refuses a server tool's input that breaks its input schema, naming every problem", async () => {
  const agent = await connectAgent();

  for (const [name, input, refusal] of [
    ["ayme_connect", {}, "Input property url is required."],
    [
      "ayme_connect",
      { link: "x" },
      "Input property link is not supported. Input property url is required.",
    ],
    ["ayme_connect", { url: 5 }, "Input property url must be a string."],
    [
      "ayme_call",
      { tool: "ListPage.addItem", args: { text: "x" } },
      "Input property args is not supported.",
    ],
    [
      "ayme_call",
      { name: "ListPage.addItem", input: { text: "x" } },
      "Input property name is not supported. Input property tool is required.",
    ],
    [
      "ayme_call",
      { tool: "ListPage.addItem", input: { text: "x" }, foo: 1 },
      "Input property foo is not supported.",
    ],
    [
      "ayme_list_tools",
      { filter: "x" },
      "Input property filter is not supported.",
    ],
  ] as const)
    expect(await agent.answer(name, input), name).toEqual({
      texts: [`ToolInputError: ${refusal}`],
      isError: true,
    });
});

it("takes a server tool's left-out arguments as {}", async () => {
  const agent = await connectAgent();

  expect(await agent.answer("ayme_list_tools")).toEqual({
    texts: ["[]"],
    isError: false,
  });
  expect(await agent.answer("ayme_connect")).toEqual({
    texts: ["ToolInputError: Input property url is required."],
    isError: true,
  });
});

it("leaves a page tool that shares a server tool's name out of the tool list", async () => {
  const agent = await connectAgent();
  await agent.publish([tool("ayme_call"), tool("Panel.remove")]);

  expect(
    (await agent.client.listTools()).tools.map(({ name }) => name)
  ).toEqual([
    "ayme_connect",
    "ayme_list_tools",
    "ayme_call",
    "ayme_noop",
    "Panel.remove",
  ]);
});

it("tells a tool that went from one never offered, called directly or through ayme_call", async () => {
  const agent = await connectAgent();
  await agent.publish([tool("Panel.remove")]);
  await agent.publish([]);
  const gone = {
    texts: [
      'The tool "Panel.remove" is gone: the page or App Process that offered it no longer does.',
    ],
    isError: true,
  };

  expect(await agent.answer("Panel.remove", {})).toMatchObject(gone);
  expect(
    await agent.answer("ayme_call", { tool: "Panel.remove" })
  ).toMatchObject(gone);
  expect(await agent.answer("Panel.paste", {})).toMatchObject({
    texts: ['Unknown tool "Panel.paste".'],
    isError: true,
  });
  expect(
    await agent.answer("ayme_call", { tool: "Panel.paste" })
  ).toMatchObject({
    texts: ['No connected page or App Process offers a tool "Panel.paste".'],
    isError: true,
  });
});
