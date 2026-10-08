import { randomUUID } from "node:crypto";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { version } from "../../package.json";
import { AgentConnection, createPageChannelServer } from "../connection";
import {
  SERVER_HOST,
  SERVER_PORTS,
  listenOnFirstFreePort,
  listenOnPort,
  type Pairing,
} from "../pairing";
import {
  createMcpToolServer,
  saveToScreenshotFolder,
  screenshotFolder,
} from "../tools";
import { connectionBehaviours } from "./connectionBehaviours";
import { serverTools } from "./serverTools";

const log = (message: string) =>
  process.stderr.write(`[ayme mcp] ${message}\n`);

/**
 * Runs the Ayme MCP server: MCP over stdio for the agent, and a WebSocket
 * server on the loopback interface for the page, on `port` if given, else on
 * the first free port of the server's range. Stops when the agent closes
 * stdio.
 */
export async function startMcpServer({
  port: pinnedPort,
}: { port?: number } = {}): Promise<void> {
  const connection = new AgentConnection();
  const token = randomUUID();
  const channel = createPageChannelServer({
    connection,
    token,
    imageFolder: screenshotFolder,
  });
  const port =
    pinnedPort === undefined
      ? await listenOnFirstFreePort(channel.server, SERVER_PORTS)
      : await listenOnPort(channel.server, pinnedPort);
  const pairing: Pairing = { address: `ws://${SERVER_HOST}:${port}`, token };

  const stopBehaviours = connectionBehaviours.map((behaviour) =>
    behaviour({ connection, log })
  );
  const mcp = createMcpToolServer({
    name: "ayme",
    version,
    serverTools: serverTools.map((tool) =>
      tool({ connection, pairing, saveImage: saveToScreenshotFolder })
    ),
    connection,
    saveImage: saveToScreenshotFolder,
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
