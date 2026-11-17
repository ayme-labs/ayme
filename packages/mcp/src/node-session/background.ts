// Spike: the background process. It attaches to the browser the developer's
// automation owns, runs one Ayme session over the marked tab with real
// Playwright, and answers the thin commands over a local socket.
import { rmSync } from "node:fs";
import { createServer } from "node:net";
import { dirname } from "node:path";

import { version } from "../../package.json";
import { ENTRY_FILE, findPageObjectsEntry } from "../served-page-objects";
import { attach, loadProjectAyme } from "./attach";
import { loadNodePageObjects } from "./nodePageObjects";
import type { SessionRequest, SessionResponse } from "./protocol";
import { removeRecord, socketFile, writeRecord } from "./record";

const PAGE_OBJECTS = "page_objects";

/** A tool's result as the text `ayme mcp` gives an agent: a string as it is, anything else as JSON. */
function resultText(result: unknown): string {
  if (result === undefined || result === null) return "null";
  return typeof result === "string" ? result : JSON.stringify(result);
}

function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return !error.name || error.name === "Error"
    ? error.message
    : `${error.name}: ${error.message}`;
}

/**
 * Runs until it is told to stop, its tab closes or the browser goes away.
 * Rejects, before it listens, when the Page Objects do not build, the
 * browser is not reachable or the mark names no one tab.
 */
export async function runBackground({
  endpoint,
  mark,
  pageObjects,
}: {
  endpoint: string;
  mark: string;
  pageObjects?: string;
}): Promise<void> {
  const folder = process.cwd();
  const entry = findPageObjectsEntry({ folder, named: pageObjects });
  if (entry === undefined)
    throw new Error(
      `There are no Page Objects to run: no --page-objects option, and no ${ENTRY_FILE} in ${folder}.`
    );
  // Built before the attach: a build that fails never touches the browser.
  const classes = await loadNodePageObjects(entry);
  const project = await loadProjectAyme(dirname(entry));
  const { page } = await attach(project, endpoint, mark);
  const session = project.ayme.createAyme({ page, pageObjects: classes });
  const stopSession = await session.start();
  // The session lists a Page Object's tools once it has looked at the page,
  // which the browser runtime does before it publishes them. Without this
  // first read, a call sent right after the start finds no tool.
  await session.agentTools.run(PAGE_OBJECTS, {}).catch(() => {});

  const offered = () =>
    session.agentTools
      .list()
      .filter(
        (tool) => tool.group === "pageObject" || tool.name === PAGE_OBJECTS
      );
  const run = async (
    name: string,
    input: unknown
  ): Promise<SessionResponse> => {
    // Only the Page Object Tools and page_objects come through this path.
    if (!offered().some((tool) => tool.name === name))
      return { ok: false, text: `There is no Page Object Tool "${name}".` };
    try {
      return {
        ok: true,
        text: resultText(await session.agentTools.run(name, input)),
      };
    } catch (error) {
      return { ok: false, text: errorText(error) };
    }
  };
  const answer = (request: SessionRequest): Promise<SessionResponse> => {
    if (request.method === "page_objects") return run(PAGE_OBJECTS, {});
    if (request.method === "call") return run(request.name, request.input);
    if (request.method === "tools")
      return Promise.resolve({
        ok: true,
        text: offered()
          .filter((tool) => tool.name !== PAGE_OBJECTS)
          .map(
            ({ name, description, inputSchema }) =>
              `${name}${description ? `: ${description}` : ""}\n  parameters: ${JSON.stringify(inputSchema)}`
          )
          .join("\n"),
      });
    return Promise.resolve({ ok: true, text: "Stopped." });
  };

  const socket = socketFile(folder, process.pid);
  rmSync(socket, { force: true });
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    removeRecord(folder);
    rmSync(socket, { force: true });
    try {
      stopSession();
    } catch {
      // The page may be gone already.
    }
    // Exiting drops the CDP connection; the browser is not Ayme's to close.
    process.exit(0);
  };
  const server = createServer({ allowHalfOpen: true }, (connection) => {
    let received = "";
    connection.setEncoding("utf8");
    connection.on("error", () => {});
    connection.on("data", (chunk: string) => {
      received += chunk;
      if (!received.includes("\n")) return;
      const request = JSON.parse(received) as SessionRequest;
      void answer(request)
        .catch((error: unknown) => ({ ok: false, text: errorText(error) }))
        .then((response) => {
          connection.end(`${JSON.stringify(response)}\n`, () => {
            if (request.method === "stop") end();
          });
        });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socket, resolve);
  });
  process.on("SIGTERM", end);
  process.on("SIGINT", end);
  page.on("close", end);
  page.context().browser()?.on("disconnected", end);
  writeRecord({
    folder,
    socket,
    pid: process.pid,
    version,
    endpoint,
    url: page.url(),
    startedAt: new Date().toISOString(),
  });
}
