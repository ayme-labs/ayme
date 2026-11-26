/* global console, process, setTimeout, URL, WebSocket, fetch */
// Spike helpers: the ayme command, the two automations' CLIs, and a raw CDP
// client on the browser target that hides and shows a Tab the ways a person
// or an automation would.
import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";

export const R = new URL("../../../..", import.meta.url).pathname.replace(
  /\/$/,
  ""
);
export const S = process.env.SPIKE_SCRATCH;
if (!S) throw new Error("Set SPIKE_SCRATCH to a scratch folder.");
export const LOG = `${S}/spike.log`;
export const FOLDER = `${R}/apps/mcp-fixture/hidden-tab-spike`;
export const env = {
  ...process.env,
  AYME_CACHE_DIR: `${S}/cache`,
  AYME_SPIKE_LOG: LOG,
};
const BIN = `${R}/apps/eval-formbricks/node_modules/.bin`;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function run(file, args, cwd, timeout = 60_000) {
  try {
    return {
      code: 0,
      out: execFileSync(file, args, {
        cwd,
        env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout,
      }).trim(),
    };
  } catch (error) {
    return {
      code: error.status ?? error.signal,
      out: `${error.stdout ?? ""}${error.stderr ?? ""}`.trim(),
    };
  }
}
export const ayme = (...args) =>
  run("node", [`${R}/packages/mcp/dist/cli.mjs`, ...args], FOLDER);
export const pw = (...args) =>
  run(`${BIN}/playwright-cli`, ["-s=hiddentab", ...args], `${S}/pwcli`);
export const ab = (...args) =>
  run(`${BIN}/agent-browser`, ["--session", "hiddentab", ...args], S);

/** Starts `ayme call` without waiting; `done` resolves with its exit, output and time. */
export function callAsync(tool, input) {
  const startedAt = Date.now();
  const child = spawn(
    "node",
    [
      `${R}/packages/mcp/dist/cli.mjs`,
      "call",
      tool,
      ...(input ? [JSON.stringify(input)] : []),
    ],
    { cwd: FOLDER, env, stdio: ["ignore", "pipe", "pipe"] }
  );
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  const done = new Promise((resolve) =>
    child.on("exit", (code) =>
      resolve({ code, out: out.trim(), ms: Date.now() - startedAt })
    )
  );
  return { startedAt, done, child };
}

export const logLines = () => {
  try {
    return readFileSync(LOG, "utf8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
};
export const events = (from) =>
  logLines()
    .slice(from)
    .map((line) => JSON.parse(line));

/** A raw CDP client on the browser at `http://127.0.0.1:<port>` or a ws URL. */
export async function cdp(endpoint) {
  const wsUrl = endpoint.startsWith("ws")
    ? endpoint
    : (await (await fetch(`${endpoint}/json/version`)).json())
        .webSocketDebuggerUrl;
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (message) => {
    const data = JSON.parse(message.data);
    if (data.id && pending.has(data.id)) {
      const { resolve, reject } = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) reject(new Error(JSON.stringify(data.error)));
      else resolve(data.result);
    }
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      pending.set(n, { resolve, reject });
      ws.send(
        JSON.stringify({
          id: n,
          method,
          params,
          ...(sessionId && { sessionId }),
        })
      );
    });
  const pages = async () =>
    (await send("Target.getTargets")).targetInfos.filter(
      (t) => t.type === "page"
    );
  return {
    send,
    pages,
    close: () => ws.close(),
    /** The page target whose URL contains `part`, the first if several. */
    async find(part) {
      return (await pages()).find((t) => t.url.includes(part));
    },
    /** `document.visibilityState` of the target, read in a session of its own. */
    async visibility(targetId) {
      const { sessionId } = await send("Target.attachToTarget", {
        targetId,
        flatten: true,
      });
      try {
        const { result } = await send(
          "Runtime.evaluate",
          { expression: "document.visibilityState", returnByValue: true },
          sessionId
        );
        return result.value;
      } finally {
        await send("Target.detachFromTarget", { sessionId }).catch(() => {});
      }
    },
    async windowOf(targetId) {
      return send("Browser.getWindowForTarget", { targetId });
    },
    async setWindowState(targetId, windowState) {
      const { windowId } = await send("Browser.getWindowForTarget", {
        targetId,
      });
      await send("Browser.setWindowBounds", {
        windowId,
        bounds: { windowState },
      });
    },
  };
}
