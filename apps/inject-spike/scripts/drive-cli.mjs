// Spike driver, Playwright CLI variant: plays a coding agent that has `ayme mcp`
// as an MCP server (MCP SDK client over stdio) and drives the browser with the
// `playwright-cli` command (`@playwright/cli`), one shell command per step,
// the way a coding agent runs it. The Ayme bundle reaches the page through the
// CLI's config file (`browser.initScript`, `browser.contextOptions`).
//
// node scripts/drive-cli.mjs --cli <path to playwright-cli> [--target <url>]
//   [--headless] [--bypass-csp] [--grant-lna] [--init baked|loader]
//   [--scenario basic|edit] [--wait-ms 15000]
import { execFile, execFileSync } from "node:child_process";
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
const SITE_PORT = 4710;
const AYME_PORT = 4720;
const SESSION = "ayme-spike";

const { values: opt } = parseArgs({
  options: {
    cli: { type: "string", default: "playwright-cli" },
    target: {
      type: "string",
      default: `http://127.0.0.1:${SITE_PORT}/notes.html`,
    },
    headless: { type: "boolean", default: false },
    "bypass-csp": { type: "boolean", default: false },
    "grant-lna": { type: "boolean", default: false },
    init: { type: "string", default: "baked" },
    scenario: { type: "string", default: "basic" },
    "wait-ms": { type: "string", default: "15000" },
  },
});

const log = (step, data) => console.log(JSON.stringify({ step, ...data }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

const work = mkdtempSync(join(tmpdir(), "ayme-inject-cli-"));
let initScript = BUNDLE;
if (opt.init === "loader") {
  initScript = join(work, "loader.js");
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
    launchOptions: { headless: opt.headless },
    contextOptions,
    initScript: [initScript],
  },
};
const configPath = join(work, "cli.config.json");
writeFileSync(configPath, JSON.stringify(config, null, 2));
log("config", { config });

/** One `playwright-cli` command, as an agent runs it in its shell. Async: this
 * process also serves the target page and talks to `ayme mcp`. */
function cli(...args) {
  const argv = [`-s=${SESSION}`, ...args];
  const cmd = `playwright-cli ${argv.join(" ")}`;
  return new Promise((resolve) =>
    execFile(
      opt.cli,
      argv,
      { cwd: work, encoding: "utf8", timeout: 60_000 },
      (e, stdout, stderr) =>
        resolve(
          e
            ? {
                cmd,
                ok: false,
                status: e.code,
                signal: e.signal,
                out: `${stdout}${stderr}`,
              }
            : { cmd, ok: true, out: stdout }
        )
    )
  );
}
const short = (r, n = 1200) => ({ ...r, out: r.out.slice(0, n) });

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [
    join(root, "node_modules/@ayme-dev/mcp/dist/cli.mjs"),
    "mcp",
    "--port",
    String(AYME_PORT),
  ],
  stderr: "pipe",
  cwd: root,
});
let aymeStderr = "";
transport.stderr?.on("data", (c) => (aymeStderr += String(c)));
const client = new Client({ name: "spike-cli", version: "0.0.0" });
await client.connect(transport);
const call = async (tool, args = {}) => {
  const r = await client.callTool({ name: tool, arguments: args });
  return {
    text: (r.content ?? []).map((c) => c.text ?? `[${c.type}]`).join("\n"),
    isError: r.isError === true,
  };
};
const SERVER_TOOLS = ["ayme_connect", "ayme_list_tools", "ayme_call"];
async function pageTools(timeout = Number(opt["wait-ms"])) {
  const deadline = Date.now() + timeout;
  let names = [];
  while (Date.now() < deadline) {
    names = (await client.listTools()).tools
      .map((t) => t.name)
      .filter((n) => !SERVER_TOOLS.includes(n));
    if (names.includes("snapshot")) return names;
    await sleep(250);
  }
  return names;
}
async function callPomTool(names) {
  const tool = names.find((n) => /read_?heading|read$|page_heading/i.test(n));
  if (!tool) return log("pom_call", { skipped: "no Page Object tool", names });
  log("pom_call", { tool, ...(await call(tool)) });
}
async function pageState() {
  log(
    "eval",
    short(
      await cli(
        "eval",
        "() => ({ spike: window.__aymeSpike ?? null, href: location.href })"
      )
    )
  );
  log("console", short(await cli("console", "debug"), 4000));
}
function rebuild() {
  execFileSync("pnpm", ["exec", "vite", "build"], {
    cwd: root,
    stdio: "ignore",
  });
}

try {
  log("version", short(await cli("--version")));
  const link = await call("ayme_connect", { url: opt.target });
  log("ayme_connect", link);
  const href = /(https?:\/\/\S+#ayme=\S+)/.exec(link.text)?.[1];
  if (!href) throw new Error("no connect link in ayme_connect's answer");
  const open = ["open", `--config=${configPath}`];
  if (!opt.headless) open.push("--headed");
  const t0 = Date.now();
  const opened = await cli(...open, href);
  log("open", { ms: Date.now() - t0, ...short(opened) });
  const names = await pageTools();
  log("page_tools", { names });
  await pageState();
  await callPomTool(names);
  if (names.includes("snapshot")) {
    const snap = await call("snapshot");
    log("snapshot", { isError: snap.isError, text: snap.text.slice(0, 600) });
  }

  if (opt.scenario === "edit") {
    const src = join(root, "src/Notes.ts");
    const before = readFileSync(src, "utf8");
    writeFileSync(
      src,
      before.replace('const VERSION = "v1"', 'const VERSION = "v2"')
    );
    try {
      rebuild();
      log("rebuilt", { version: "v2" });
      log("reload", short(await cli("reload")));
      await sleep(1500);
      const after = await pageTools();
      log("page_tools_after_reload", { names: after });
      await callPomTool(after);
      log("tab_new", short(await cli("tab-new", opt.target)));
      await sleep(1500);
      log("page_tools_new_tab", { names: await pageTools() });
      log("ayme_call_new_tab_note", {
        hint: "the stored pairing is per origin, so a new same-origin tab may pair",
      });
      await callPomTool(await pageTools());
    } finally {
      writeFileSync(src, before);
      rebuild();
      log("restored", { version: "v1" });
    }
  }
} catch (error) {
  log("error", { message: String(error?.stack ?? error) });
} finally {
  log("ayme_stderr", { text: aymeStderr.slice(-2000) });
  log("close", short(await cli("close")));
  await client.close().catch(() => {});
  site.close();
  process.exit(0);
}
