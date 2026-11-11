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
  ENTRY_FILE,
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
 * which loads it into a page that doesn't ship Ayme. With `webMCP`, the
 * runtime that init script starts also publishes its tools through WebMCP;
 * without an entry to serve, `webMCP` is refused. Experimental (ADR-0037).
 *
 * With `onlyPageObjectTools`, the server is for an agent whose own browser
 * tool drives the page: the runtime that init script starts hands the
 * server the Page Object Tools and `page_objects` alone, as WebMCP
 * publishes them, and the server lists those and nothing else, neither its
 * own tools nor an App Process's, and adds no tool change note to a
 * result. A page then pairs only by itself, since nothing returns a
 * connect link. Refused without an entry to serve, as `webMCP` is: a page
 * that starts Ayme itself would hand the server every tool of its session.
 * Experimental too.
 */
export async function startMcpServer({
  port: pinnedPort,
  pageObjects,
  webMCP,
  onlyPageObjectTools = false,
}: {
  port?: number;
  pageObjects?: string;
  webMCP?: boolean;
  onlyPageObjectTools?: boolean;
} = {}): Promise<void> {
  const folder = process.cwd();
  const entry = findPageObjectsEntry({ folder, named: pageObjects });
  for (const [option, set] of [
    ["--webmcp", webMCP],
    ["--only-page-object-tools", onlyPageObjectTools],
  ] as const)
    if (set && entry === undefined)
      throw new Error(
        `${option} needs a Page Objects entry to serve: name one with --page-objects, or add ${ENTRY_FILE} to ${folder}.`
      );
  const connection = new AgentConnection({
    onlyPageTools: onlyPageObjectTools,
  });
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
      ...(build ? [servedPageObjectsServer(build)] : []),
    ],
  });
  const closeBuild = () =>
    void build?.then(
      (b) => b.close(),
      () => {}
    );
  let port: number;
  try {
    port =
      pinnedPort === undefined
        ? await listenOnFirstFreePort(channel.server, SERVER_PORTS)
        : await listenOnPort(channel.server, pinnedPort);
  } catch (error) {
    // The watcher would keep the process alive after a failed start.
    channel.close();
    closeBuild();
    throw error;
  }
  const pairing: Pairing = { address: `ws://${SERVER_HOST}:${port}`, token };
  let initScript: string | undefined;
  if (entry !== undefined)
    await writeInitScript({
      folder,
      port,
      webMCP,
      onlyPageObjectTools,
    }).then(
      (written) => {
        initScript = written;
        log(
          `Serving ${entry} to pages that load ${written}${webMCP ? ", which also publish its tools through WebMCP" : ""}.`
        );
        if (onlyPageObjectTools)
          log(
            "Listing only the Page Object Tools and page_objects of the page that loads it."
          );
      },
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
    serverTools: onlyPageObjectTools ? [] : serverTools,
    toolChangeNotes: !onlyPageObjectTools,
    context: {
      connection,
      pairing,
      saveImage: saveToScreenshotFolder,
      initScript,
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
    closeBuild();
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
