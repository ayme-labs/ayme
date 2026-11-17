/**
 * Does the task with no agent: starts `ayme mcp` the documented way, opens
 * the connect link in Chrome with the init script, and calls the served Page
 * Object Tools through `ayme_call`. It proves the registry install, the
 * fixture app, the served Page Objects, the recorder and the outcome check
 * fit together before any model is paid for.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import { freePort } from "./registry.ts";

type Rpc = {
  call: (method: string, params: object) => Promise<any>;
  stop: () => void;
};

function startMcp(
  project: string,
  version: string,
  port: number,
  env: NodeJS.ProcessEnv
): Rpc {
  const child = spawn(
    "npx",
    ["-y", `@ayme-dev/mcp@${version}`, "mcp", "--port", String(port)],
    { cwd: project, env, stdio: ["pipe", "pipe", "inherit"], detached: true }
  );
  let id = 0;
  const pending = new Map<number, (message: any) => void>();
  let buffer = "";
  child.stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      try {
        const message = JSON.parse(line);
        if (message.id !== undefined) pending.get(message.id)?.(message);
      } catch {
        // Not JSON-RPC.
      }
    }
  });
  const send = (message: object) =>
    child.stdin.write(`${JSON.stringify(message)}\n`);
  return {
    call: (method, params) =>
      new Promise((resolve, reject) => {
        id += 1;
        const timer = setTimeout(
          () => reject(new Error(`${method} timed out`)),
          60_000
        );
        pending.set(id, (message) => {
          clearTimeout(timer);
          if (message.error) reject(new Error(JSON.stringify(message.error)));
          else resolve(message.result);
        });
        send({ jsonrpc: "2.0", id, method, params });
        if (method === "initialize")
          send({ jsonrpc: "2.0", method: "notifications/initialized" });
      }),
    stop: () => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGTERM");
      } catch {
        // Already gone.
      }
    },
  };
}

const text = (result: any): string =>
  (result?.content ?? []).map((c: any) => c.text ?? "").join("\n");

/** The id `page_objects` gives the ListItem whose name button reads `name`. */
function itemId(tree: string, name: string): string {
  const lines = tree.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const match = /ListItem (po\d+)/.exec(lines[i]!);
    if (!match) continue;
    for (
      let j = i + 1;
      j < lines.length && !/ListItem po\d+/.test(lines[j]!);
      j += 1
    ) {
      if (lines[j]!.includes(`"${name}"`)) return match[1]!;
    }
  }
  throw new Error(`No ListItem named ${name} in:\n${tree}`);
}

export async function selfCheck(
  project: string,
  version: string,
  page: string,
  n: string,
  env: NodeJS.ProcessEnv,
  log: (line: string) => void
): Promise<void> {
  const port = await freePort();
  const mcp = startMcp(project, version, port, env);
  const require = createRequire(join(project, "package.json"));
  const { chromium } = require("@playwright/test");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    await mcp.call("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "eval-first-install-self-check", version: "0" },
    });
    const connect = text(
      await mcp.call("tools/call", {
        name: "ayme_connect",
        arguments: { url: page },
      })
    );
    log(`ayme_connect: ${connect}`);
    const link = /https?:\/\/\S+#ayme=\S+/.exec(connect)?.[0];
    if (!link) throw new Error(`No connect link in: ${connect}`);
    const initScript = join(project, ".ayme", "init-script.js");
    if (!existsSync(initScript))
      throw new Error(`ayme mcp wrote no ${initScript}`);
    const context = await browser.newContext({ bypassCSP: true });
    await context.addInitScript({ path: initScript });
    const tab = await context.newPage();
    await tab.goto(link);

    const call = async (tool: string, input: object) => {
      const result = await mcp.call("tools/call", {
        name: "ayme_call",
        arguments: { tool, input },
      });
      const answer = text(result);
      log(`${tool} ${JSON.stringify(input)} -> ${answer.slice(0, 400)}`);
      if (result.isError) throw new Error(`${tool} failed: ${answer}`);
      return answer;
    };
    const deadline = Date.now() + 30_000;
    for (;;) {
      const tools = text(
        await mcp.call("tools/call", { name: "ayme_list_tools", arguments: {} })
      );
      if (tools.includes("ListPage.addItem")) break;
      if (Date.now() > deadline)
        throw new Error(`The page's tools never arrived:\n${tools}`);
      await new Promise((r) => setTimeout(r, 500));
    }
    await call("ListPage.addItem", { text: `Oat milk ${n}` });
    await call("ListPage.addItem", { text: `Rye bread ${n}` });
    let tree = await call("page_objects", {});
    await call("ListItem.rename", {
      id: itemId(tree, `Oat milk ${n}`),
      args: { text: `Soy milk ${n}` },
    });
    tree = await call("page_objects", {});
    await call("ListItem.archive", { id: itemId(tree, `Rye bread ${n}`) });
    await call("page_objects", {});
  } finally {
    await browser.close();
    mcp.stop();
  }
}
