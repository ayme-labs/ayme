import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, expect, it } from "vitest";

import { AgentConnection } from "../../connection";
import type { PageTool } from "../../contract";
import { listToolsTool } from "../application/listToolsTool";
import { textResult } from "../domain/toolResult";
import { createMcpToolServer } from "./mcpToolServer";

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

/** A server with a paired page, and an agent connected to it over memory. */
async function connectAgent() {
  const connection = new AgentConnection();
  const page = connection.attach({ tab: "a", url: "http://x/" }, () => {})!;
  const server = createMcpToolServer({
    name: "ayme",
    version: "0.0.0",
    serverTools: [
      listToolsTool({
        connection,
        pairing: { address: "ws://x", token: "t" },
        saveImage: async () => "/x",
      }),
      {
        name: "ayme_noop",
        description: "Does nothing.",
        inputSchema: { type: "object" },
        call: async () => textResult("ok"),
      },
    ],
    connection,
    saveImage: async () => "/x",
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  let listChanges = 0;
  client.setNotificationHandler(
    ToolListChangedNotificationSchema,
    () => void listChanges++
  );
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  closers.push(async () => {
    await client.close();
    await server.close();
  });
  const publish = async (tools: PageTool[]) => {
    page.publishTools(tools);
    await settle();
  };
  const call = async (name: string) => {
    const result = (await client.callTool({ name, arguments: {} })) as {
      content: { type: string; text?: string }[];
    };
    return result.content.map(({ text }) => text);
  };
  return { client, publish, call, listChanges: () => listChanges };
}

it("announces a changed tool list on presence only, and lists an unavailable tool without its availability", async () => {
  const agent = await connectAgent();

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
  const agent = await connectAgent();
  await agent.publish([tool("Panel.remove"), tool("Panel.copy")]);
  // Before its first call the agent has seen no tools.
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
