// Spike driver: plays a coding agent with two MCP servers, `ayme mcp` and
// Playwright MCP (`@playwright/mcp`), both over stdio through the MCP SDK
// client, the way an agent's MCP host talks to them. Playwright MCP gets the
// Ayme bundle as an init script. Every step and its result go to stdout as
// JSON lines, so a run can be pasted as evidence.
//
// node scripts/drive.mjs [--target <url>] [--headless] [--channel chrome]
//   [--bypass-csp] [--grant-lna] [--init baked|loader] [--scenario basic|edit|nav]
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const BUNDLE = join(root, "dist/ayme-inject.js");
const SITE_PORT = 4710; // the static target page and the loader's bundle URL
const AYME_PORT = 4720; // outside 9350-9365, so no localhost page auto-pairs

const { values: opt } = parseArgs({
  options: {
    target: {
      type: "string",
      default: `http://127.0.0.1:${SITE_PORT}/notes.html`,
    },
    headless: { type: "boolean", default: false },
    channel: { type: "string" },
    "bypass-csp": { type: "boolean", default: false },
    "grant-lna": { type: "boolean", default: false },
    init: { type: "string", default: "baked" },
    scenario: { type: "string", default: "basic" },
    "wait-ms": { type: "string", default: "15000" },
    screen: { type: "string" },
    next: { type: "string" },
  },
});

const log = (step, data) => console.log(JSON.stringify({ step, ...data }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- the static site: the target page, and the bundle for the loader ------
const site = createServer((req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  const file = path === "/ayme-inject.js" ? BUNDLE : join(root, "site", path);
  if (!existsSync(file) || path === "/") return res.writeHead(404).end();
  const type = { ".js": "text/javascript", ".html": "text/html" }[
    extname(file)
  ];
  res.writeHead(200, {
    "content-type": type ?? "application/octet-stream",
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
  });
  res.end(readFileSync(file));
});
await new Promise((r) => site.listen(SITE_PORT, "127.0.0.1", r));

// --- the init script: the baked bundle, or a loader that fetches it -------
const work = mkdtempSync(join(tmpdir(), "ayme-inject-"));
let initScript = BUNDLE;
if (opt.init === "loader") {
  initScript = join(work, "loader.js");
  // Synchronous, so the bundle still runs before the page's own scripts.
  writeFileSync(
    initScript,
    `(() => {
  try {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", "http://127.0.0.1:${SITE_PORT}/ayme-inject.js?t=" + Date.now(), false);
    xhr.send();
    (0, eval)(xhr.responseText);
  } catch (error) {
    console.error("[ayme-spike-loader] failed: " + error);
  }
})();\n`
  );
}

const contextOptions = {};
if (opt["bypass-csp"]) contextOptions.bypassCSP = true;
if (opt["grant-lna"]) contextOptions.permissions = ["local-network-access"];
const config = {
  browser: {
    browserName: "chromium",
    isolated: true,
    launchOptions: {
      headless: opt.headless,
      ...(opt.channel ? { channel: opt.channel } : {}),
    },
    contextOptions,
    initScript: [initScript],
  },
};
const configPath = join(work, "playwright-mcp.json");
writeFileSync(configPath, JSON.stringify(config, null, 2));
log("config", { config });

// --- the two MCP servers -------------------------------------------------
async function connect(name, command, args) {
  const transport = new StdioClientTransport({
    command,
    args,
    stderr: "pipe",
    cwd: root,
  });
  let stderr = "";
  transport.stderr?.on("data", (c) => (stderr += String(c)));
  const client = new Client({ name: `spike-${name}`, version: "0.0.0" });
  await client.connect(transport);
  return {
    client,
    stderr: () => stderr,
    async call(tool, args = {}) {
      const r = await client.callTool({ name: tool, arguments: args });
      const text = (r.content ?? [])
        .map((c) => c.text ?? `[${c.type}]`)
        .join("\n");
      return { text, isError: r.isError === true };
    },
    async names() {
      return (await client.listTools()).tools.map((t) => t.name);
    },
  };
}

const aymeCli = join(root, "node_modules/@ayme-dev/mcp/dist/cli.mjs");
const pwCli = join(root, "node_modules/@playwright/mcp/cli.js");
const ayme = await connect("ayme", process.execPath, [
  aymeCli,
  "mcp",
  "--port",
  String(AYME_PORT),
]);
const pw = await connect("playwright", process.execPath, [
  pwCli,
  "--config",
  configPath,
]);
const SERVER_TOOLS = ["ayme_connect", "ayme_list_tools", "ayme_call"];

async function pageTools(timeout = Number(opt["wait-ms"])) {
  const deadline = Date.now() + timeout;
  let names = [];
  while (Date.now() < deadline) {
    names = (await ayme.names()).filter((n) => !SERVER_TOOLS.includes(n));
    if (names.includes("snapshot")) return names;
    await sleep(250);
  }
  return names;
}

async function pageState() {
  const r = await pw.call("browser_evaluate", {
    function:
      "() => ({ spike: window.__aymeSpike ?? null, href: location.href })",
  });
  const console_ = await pw.call("browser_console_messages", {
    level: "debug",
  });
  return {
    evaluate: r.text.slice(0, 1500),
    console: console_.text.slice(0, 4000),
  };
}

function build() {
  return new Promise((resolve, reject) => {
    const b = spawn("pnpm", ["exec", "vite", "build"], {
      cwd: root,
      stdio: "ignore",
    });
    b.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`build exit ${code}`))
    );
  });
}

async function pairAndList(url) {
  const link = await ayme.call("ayme_connect", { url });
  log("ayme_connect", link);
  const href = /(https?:\/\/\S+#ayme=\S+)/.exec(link.text)?.[1];
  if (!href) throw new Error("no connect link in ayme_connect's answer");
  const nav = await pw.call("browser_navigate", { url: href });
  if (opt.screen) {
    // A headed browser's permission prompt is browser chrome, not page content: capture the screen.
    await sleep(2500);
    spawn("screencapture", ["-x", opt.screen]);
  }
  log("browser_navigate", {
    isError: nav.isError,
    text: nav.text.slice(0, 600),
  });
  const names = await pageTools();
  log("page_tools", { names });
  log("page_state", await pageState());
  return names;
}

async function callPomTool(names) {
  const tool = names.find((n) => /read_?heading|read$|page_heading/i.test(n));
  if (!tool)
    return log("pom_call", { skipped: "no Page Object tool listed", names });
  const r = await ayme.call(tool, {});
  log("pom_call", { tool, ...r });
  return r;
}

try {
  const names = await pairAndList(opt.target);
  await callPomTool(names);
  if (names.includes("snapshot")) {
    const snap = await ayme.call("snapshot", {});
    log("snapshot", { isError: snap.isError, text: snap.text.slice(0, 800) });
  }

  if (opt.scenario === "probe") {
    // What the page itself sees of Local Network Access: the permission state,
    // and what a fresh WebSocket to the server does within 8 s.
    const probe = await pw.call("browser_evaluate", {
      function: `async () => {
        let permission;
        try { permission = (await navigator.permissions.query({ name: "local-network-access" })).state; }
        catch (e) { permission = "query threw: " + e.message; }
        const events = [];
        const t0 = performance.now();
        const ws = new WebSocket("ws://127.0.0.1:${AYME_PORT}/probe");
        for (const type of ["open", "error", "close"]) ws.addEventListener(type, () => events.push(type + "@" + Math.round(performance.now() - t0) + "ms"));
        await new Promise((r) => setTimeout(r, 8000));
        const readyState = ["CONNECTING", "OPEN", "CLOSING", "CLOSED"][ws.readyState];
        ws.close();
        return { permission, readyState, events, isSecureContext };
      }`,
    });
    log("lna_probe", { text: probe.text.slice(0, 600) });
  }

  if (opt.scenario === "edit") {
    // Edit the Page Object, rebuild, reload, and read the tool again.
    const src = join(root, "src/Notes.ts");
    const before = readFileSync(src, "utf8");
    writeFileSync(
      src,
      before.replace('const VERSION = "v1"', 'const VERSION = "v2"')
    );
    try {
      await build();
      log("rebuilt", { version: "v2" });
      // A reload, as an agent does it through Playwright MCP.
      const reload = await pw.call("browser_evaluate", {
        function: "() => location.reload()",
      });
      log("reload", { isError: reload.isError });
      await sleep(1500);
      const after = await pageTools();
      log("page_tools_after_reload", { names: after });
      await callPomTool(after);
      // A baked script is read when Playwright MCP opens its context: close the browser and pair again.
      log("browser_close", await pw.call("browser_close"));
      await callPomTool(await pairAndList(opt.target));
    } finally {
      writeFileSync(src, before);
      await build();
      log("restored", { version: "v1" });
    }
  }

  if (opt.scenario === "nav") {
    // Same-origin navigation without a fresh link: does the stored pairing hold?
    const next = opt.next ?? new URL("/notes-2.html", opt.target).href;
    const nav = await pw.call("browser_navigate", { url: next });
    log("browser_navigate_same_origin", { isError: nav.isError });
    await sleep(1500);
    const after = await pageTools();
    log("page_tools_after_nav", { names: after });
    log("page_state_after_nav", await pageState());
    await callPomTool(after);
    // Synthetic input through Playwright Lite.
    const add = after.find((n) => /add_?note/i.test(n));
    if (add)
      log("pom_add_note", {
        tool: add,
        ...(await ayme.call(add, { text: "milk" })),
      });
  }
} catch (error) {
  log("error", { message: String(error?.stack ?? error) });
} finally {
  log("ayme_stderr", { text: ayme.stderr().slice(-3000) });
  log("playwright_stderr", { text: pw.stderr().slice(-2000) });
  await pw.call("browser_close").catch(() => {});
  await Promise.allSettled([ayme.client.close(), pw.client.close()]);
  site.close();
  process.exit(0);
}
