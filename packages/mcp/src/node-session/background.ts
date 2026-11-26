// Spike: the background process. It attaches to the browser the developer's
// automation owns, runs one Ayme session over the marked tab with real
// Playwright, and answers the thin commands over a local socket.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { dirname } from "node:path";

import { version } from "../../package.json";
import { ENTRY_FILE, findPageObjectsEntry } from "../served-page-objects";
import type { BrowserContext, Page } from "@playwright/test";

import { attach, loadProjectAyme } from "./attach";
import { spikeLog, watchDialogs } from "./dialogs";
import { hiddenMode, hiddenText, watchVisibility } from "./visibility";
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
  launch,
  url,
  cdpPort,
}: {
  endpoint?: string;
  mark?: string;
  pageObjects?: string;
  /** Spike (hidden tab): `ayme open` starts a browser of its own instead of joining one. */
  launch?: "headed" | "headless";
  url?: string;
  cdpPort?: string;
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
  let page: Page;
  let owned: BrowserContext | undefined;
  if (launch) {
    // Spike (hidden tab): a persistent profile, so a tab opened over CDP's
    // HTTP endpoint joins the same window, as the user's would.
    await project.ayme.registerAymeRef(project.playwright.selectors);
    owned = await project.playwright.chromium.launchPersistentContext(
      mkdtempSync(`${tmpdir()}/ayme-open-`),
      {
        headless: launch === "headless",
        viewport: null,
        args: [
          ...(cdpPort ? [`--remote-debugging-port=${cdpPort}`] : []),
          "--window-size=480,400",
          "--window-position=40,40",
        ],
      }
    );
    page = owned.pages()[0] ?? (await owned.newPage());
    await page.goto(url!);
  } else ({ page } = await attach(project, endpoint!, mark!));
  // Spike (hidden tab), AYME_SPIKE_FOCUS=1: focus emulation on ayme's own
  // CDP session, as Playwright sets it on every page it owns. Chromium then
  // counts the Tab as captured, so it stays visible and keeps drawing frames
  // while another Tab is in front or its window is minimised.
  const focus =
    process.env.AYME_SPIKE_FOCUS === "1"
      ? await page.context().newCDPSession(page)
      : undefined;
  await focus?.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  const dialogs = await watchDialogs(page, project.ayme.spikeRunGate);
  // Spike (hidden tab): hears the Tab's visibility, and ends a Run whose Tab is hidden in "end" mode.
  const visibility = await watchVisibility(page, (state) => {
    if (state === "hidden" && hiddenMode === "end")
      dialogs.endCurrent(
        hiddenText(true),
        "the Tab was hidden during the Run, so Ayme stopped the action."
      );
  });
  spikeLog("hidden-mode", {
    hiddenMode,
    launch,
    focus: focus !== undefined,
    at: visibility.state(),
  });
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
  const toolCount = () =>
    offered().filter((tool) => tool.name !== PAGE_OBJECTS).length;
  const run = async (
    name: string,
    input: unknown
  ): Promise<SessionResponse> => {
    // Only the Page Object Tools and page_objects come through this path.
    if (!offered().some((tool) => tool.name === name))
      return { ok: false, text: `There is no Page Object Tool "${name}".` };
    spikeLog("command", { name, visibility: visibility.state() });
    // Spike (hidden tab): the rule already agreed, behind the variant.
    if (
      hiddenMode !== "off" &&
      name !== PAGE_OBJECTS &&
      visibility.state() === "hidden"
    )
      return { ok: false, text: hiddenText(false) };
    return dialogs.wrap(
      name,
      async () => {
        try {
          return {
            ok: true,
            text: resultText(await session.agentTools.run(name, input)),
          };
        } catch (error) {
          return { ok: false, text: errorText(error) };
        }
      },
      (text) => ({ ok: false, text })
    );
  };
  const answer = (request: SessionRequest): Promise<SessionResponse> => {
    // Spike (dialogs): while a dialog is open, nothing that needs the page waits for it.
    const dialog = dialogs.openText();
    if (
      dialog !== undefined &&
      (request.method === "page_objects" || request.method === "call")
    )
      return Promise.resolve({ ok: false, text: dialog });
    if (request.method === "page_objects")
      return run(PAGE_OBJECTS, {}).then((response) => {
        const count = toolCount();
        // The tree names no tool; the last line only says how many `ayme tools` lists.
        return response.ok && count > 0
          ? {
              ...response,
              text: `${response.text}\n${count} Page Object Tool${count === 1 ? "" : "s"} on this screen: ayme tools`,
            }
          : response;
      });
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
    // Exiting drops the CDP connection; a joined browser is not Ayme's to
    // close, one `ayme open` started is.
    if (owned) void owned.close().finally(() => process.exit(0));
    else process.exit(0);
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
  if (owned) owned.on("close", end);
  writeRecord({
    folder,
    socket,
    pid: process.pid,
    version,
    endpoint: endpoint ?? `launched ${launch}`,
    url: page.url(),
    startedAt: new Date().toISOString(),
  });
}
