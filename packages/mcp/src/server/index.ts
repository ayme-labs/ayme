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
  findPageObjectsEntry,
  servedPageObjectsServer,
  watchPageObjects,
  writeInitScript,
} from "../served-page-objects";
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
 *
 * With a Page Objects entry, `pageObjects` or else `.ayme/page-objects.ts`
 * in the working folder, it also builds the entry in watch mode, serves its
 * last good build on the same server, and writes `.ayme/init-script.js`,
 * which loads it into a page that doesn't ship Ayme. Experimental (ADR-0037).
 */
export async function startMcpServer({
  port: pinnedPort,
  pageObjects,
}: { port?: number; pageObjects?: string } = {}): Promise<void> {
  const folder = process.cwd();
  const entry = findPageObjectsEntry({ folder, named: pageObjects });
  const connection = new AgentConnection();
  const token = randomUUID();
  // The MCP server starts after the page's: a page may say hello before it.
  let agentName = (): string | undefined => undefined;
  // The external Inspector and the Page Objects entry's build are served
  // by this server, the Inspector relayed over its page channel: no other
  // server and no other port.
  // It rebuilds as the entry's files change, and logs each outcome.
  const build = entry === undefined ? undefined : watchPageObjects(entry, log);
  build?.catch((error: unknown) => log((error as Error).message));
  const channel = createPageChannelServer({
    connection,
    token,
    imageFolder: screenshotFolder,
    agent: () => agentName(),
    extensions: [
      externalInspectorServer({
        relay: new InspectorRelay(connection),
        readBuild: readExternalBuild,
      }),
      ...(build
        ? [servedPageObjectsServer(() => build.then((b) => b.modules()))]
        : []),
    ],
  });
  const port =
    pinnedPort === undefined
      ? await listenOnFirstFreePort(channel.server, SERVER_PORTS)
      : await listenOnPort(channel.server, pinnedPort);
  const pairing: Pairing = { address: `ws://${SERVER_HOST}:${port}`, token };
  if (entry !== undefined)
    await writeInitScript({ folder, port }).then(
      (initScript) => log(`Serving ${entry} to pages that load ${initScript}.`),
      (error: unknown) =>
        log(
          `Writing the init script for ${entry} failed: ${(error as Error).message}`
        )
    );

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
    void build?.then(
      (b) => b.close(),
      () => {}
    );
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
