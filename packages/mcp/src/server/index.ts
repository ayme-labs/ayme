import { randomUUID } from "node:crypto";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { version } from "../../package.json";
import { AgentConnection, createPageChannelServer } from "../connection";
import {
  InspectorRelay,
  externalInspectorServer,
  inspectCommand,
  inspectorUrl,
  readExternalBuild,
} from "../inspector";
import {
  SERVER_HOST,
  SERVER_PORTS,
  findServers,
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
  // The MCP server starts after the page's: a page may say hello before it.
  let agentName = (): string | undefined => undefined;
  // The external Inspector is served by this server and relayed over its
  // page channel: no other server and no other port.
  const channel = createPageChannelServer({
    connection,
    token,
    imageFolder: screenshotFolder,
    agent: () => agentName(),
    extension: externalInspectorServer({
      relay: new InspectorRelay(connection),
      readBuild: readExternalBuild,
    }),
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
    serverTools,
    context: {
      connection,
      pairing,
      saveImage: saveToScreenshotFolder,
      inspector: {
        url: inspectorUrl(SERVER_HOST, port),
        installed: async () => (await readExternalBuild()) !== undefined,
      },
    },
  });
  agentName = () => mcp.getClientVersion()?.name;

  const stop = () => {
    for (const stopBehaviour of stopBehaviours) stopBehaviour();
    channel.close();
  };
  mcp.onclose = stop;
  process.stdin.once("end", () => void mcp.close());
  await mcp.connect(new StdioServerTransport());
  log(`Listening for pages on ${pairing.address}.`);
}
export { readCommand } from "./readCommand";

/**
 * Prints the URL of the external Inspector of the running Ayme MCP server
 * (every one that answers, in port order) on stdout, or says why there is
 * none on stderr. A server with a page paired answers a local process's
 * probe too, so it counts. Returns the exit code.
 */
export async function printInspectorUrl({
  port,
}: { port?: number } = {}): Promise<number> {
  const { ok, text } = await inspectCommand({
    installed: async () => (await readExternalBuild()) !== undefined,
    servers: () =>
      findServers(
        port === undefined ? SERVER_PORTS : { first: port, last: port }
      ),
  });
  (ok ? process.stdout : process.stderr).write(text);
  return ok ? 0 : 1;
}
