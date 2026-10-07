import {
  type Agent,
  connectPage,
  freePort,
  ignoreAutoPairScan,
  startAgent,
} from "@ayme-dev/mcp/testing";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { test as base, expect, type Page } from "@playwright/test";

export { expect };
export {
  Agent,
  SERVER_TOOLS,
  aymeCommand,
  freePort,
  startAgent,
} from "@ayme-dev/mcp/testing";

/** A stand-in App Process the test started, see `appProcess.ts`. */
export type AppProcess = {
  /** What it wrote to stdout and stderr so far. */
  output(): string;
  /** Ends it and resolves once it exited. */
  exit(): Promise<void>;
};

/** Where the App Process looks for the server, and the tool it offers. */
export type AppProcessOptions = {
  /** The one port it scans. */
  port?: number;
  /** A connect link that names the server. */
  link?: string;
  /** The name of its one Peek; `jobs`, read as `peek.node.jobs`, by default. */
  peek?: string;
  /** What its Peek reads, as `{ value }`. */
  value?: string;
};

const APP_PROCESS = fileURLToPath(new URL("./appProcess.ts", import.meta.url));

export const test = base.extend<{
  /**
   * Starts a stand-in App Process; every one the test started exits when
   * the test ends.
   */
  startAppProcess: (options: AppProcessOptions) => AppProcess;
  /**
   * The agent's server. It listens outside the range a page's auto-pair scan
   * probes, unless a spec sets `inScanRange`, so a localhost page of another
   * suite running beside this one never pairs with it by itself.
   */
  agent: Awaited<ReturnType<typeof startAgent>>;
  /** Whether the `agent` fixture's server listens in the scanned range. */
  inScanRange: boolean;
  /**
   * Asks the agent's server for a connect link to `path` on the fixture app,
   * opens it in the page and waits until the page's tools are MCP tools.
   * Returns the link.
   */
  connect: (path?: string) => Promise<string>;
  /**
   * The ports whose Ayme MCP server the page's auto-pair scan can find;
   * none unless a test adds them. It keeps a page from auto-pairing with a
   * server of another test, or of another run on this machine.
   */
  scanReaches: Set<number>;
  /**
   * Whether `scanReaches` routes the scan's probes; on unless a spec turns
   * it off. Once a context routes any WebSocket, Playwright relays every
   * WebSocket of its pages, and a message a page sends as it unloads is
   * lost. A spec whose pages always pair by link, so never scan, turns it
   * off to test what the page says as it leaves.
   */
  limitScan: boolean;
}>({
  limitScan: [true, { option: true }],
  // Playwright reads a fixture's dependencies from its first parameter.
  // eslint-disable-next-line no-empty-pattern
  startAppProcess: async ({}, use) => {
    const started: AppProcess[] = [];
    try {
      await use((options) => {
        const appProcess = startAppProcess(options);
        started.push(appProcess);
        return appProcess;
      });
    } finally {
      await Promise.all(started.map((appProcess) => appProcess.exit()));
    }
  },
  inScanRange: [false, { option: true }],
  agent: async ({ inScanRange }, use) => {
    const agent = await (inScanRange
      ? startAgent()
      : startAgent("--port", String(await freePort())));
    try {
      await use(agent);
    } finally {
      await agent.close();
    }
  },
  connect: async ({ agent, page, baseURL }, use) => {
    await use((path = "/") =>
      connectPage(agent, page, new URL(path, baseURL).href)
    );
  },
  scanReaches: [
    async ({ context, limitScan }, use) => {
      const ports = new Set<number>();
      if (!limitScan) return use(ports);
      // Answers every other probe of the scan as no Ayme MCP server would.
      await ignoreAutoPairScan(context, ports);
      await use(ports);
    },
    { auto: true },
  ],
});

/** The WebSocket address and port of the agent's server, from its link. */
export async function serverAddress(agent: Agent) {
  const { text } = await agent.call("ayme_connect", {
    url: "http://127.0.0.1/",
  });
  const address = /#ayme=(ws:\/\/127\.0\.0\.1:(\d+))\//.exec(text);
  expect(address, text).not.toBeNull();
  return { address: address![1]!, port: Number(address![2]) };
}

/** The ref of the page's "Add item" button, from its snapshot, as an agent finds one. */
export async function addItemRef(agent: Agent) {
  const { text: snapshot } = await agent.call("snapshot");
  const ref = /(e\d+) button "Add item"/.exec(
    JSON.parse(snapshot).structure
  )?.[1];
  expect(ref, snapshot).toBeDefined();
  return ref!;
}

/** The pairing `page`'s tab keeps in sessionStorage, as stored, or `null`. */
export function storedPairing(page: Page) {
  return page.evaluate(() => sessionStorage.getItem("ayme:agent-connection"));
}

/**
 * Calls the fixture's `hold` tool, which never answers, on the "Add item"
 * button of `page`, and waits until the page runs it. Returns the call's
 * pending result as `answer`.
 */
export async function holdCall(
  agent: Agent,
  page: Page
): Promise<{ answer: ReturnType<Agent["call"]> }> {
  const ref = await addItemRef(agent);
  const answer = agent.call("hold", { ref });
  // A test may leave the call in flight; closing the agent then rejects it.
  answer.catch(() => {});
  await expect(page.locator(`html[data-holding="${ref}"]`)).toBeAttached();
  return { answer };
}

/** The JSON answer the server gives a call its page left unanswered. */
export function unanswered(answer: { text: string; isError: boolean }) {
  expect(answer.isError, answer.text).toBe(true);
  return JSON.parse(answer.text) as {
    error: string;
    settled?: false;
    loading?: string;
    tools?: string[];
    next: string;
  };
}

function startAppProcess({
  port,
  link,
  peek,
  value,
}: AppProcessOptions): AppProcess {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (port !== undefined) env.AYME_PROCESS_PORT = String(port);
  if (link !== undefined) env.AYME_PROCESS_LINK = link;
  if (peek !== undefined) env.AYME_PROCESS_PEEK = peek;
  if (value !== undefined) env.AYME_PROCESS_VALUE = value;
  const child = spawn(process.execPath, [APP_PROCESS], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => (output += String(chunk)));
  child.stderr.on("data", (chunk: Buffer) => (output += String(chunk)));
  const exited = new Promise<void>((resolve) =>
    child.once("exit", () => resolve())
  );
  return {
    output: () => output,
    exit() {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      return exited;
    },
  };
}
