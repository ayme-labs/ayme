import { randomUUID } from "node:crypto";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { version } from "../../package.json";
import { AgentConnection, createPageChannelServer } from "../connection";
import {
  SERVER_HOST,
  SERVER_PORTS,
  listenOnFirstFreePort,
  type Pairing,
} from "../pairing";
import { createMcpToolServer } from "../tools";
import { connectionBehaviours } from "./connectionBehaviours";
import { serverTools } from "./serverTools";

const log = (message: string) =>
  process.stderr.write(`[ayme mcp] ${message}\n`);

/**
 * Runs the Ayme MCP server: MCP over stdio for the agent, and a WebSocket
 * server on the loopback interface for the page. Stops when the agent closes
 * stdio.
 */
export async function startMcpServer(): Promise<void> {
  const connection = new AgentConnection();
  const token = randomUUID();
  const channel = createPageChannelServer({ connection, token });
  const port = await listenOnFirstFreePort(channel.server, SERVER_PORTS);
  const pairing: Pairing = { address: `ws://${SERVER_HOST}:${port}`, token };

  const stopBehaviours = connectionBehaviours.map((behaviour) =>
    behaviour({ connection, log })
  );
  const mcp = createMcpToolServer({
    name: "ayme",
    version,
    serverTools: serverTools.map((tool) => tool({ connection, pairing })),
    connection,
  });

  const stop = () => {
    for (const stopBehaviour of stopBehaviours) stopBehaviour();
    channel.close();
  };
  mcp.onclose = stop;
  process.stdin.once("end", () => void mcp.close());
  await mcp.connect(new StdioServerTransport());
  log(`Listening for pages on ${pairing.address}.`);
}
