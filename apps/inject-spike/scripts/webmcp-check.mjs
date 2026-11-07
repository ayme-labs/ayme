// Side check: does Playwright MCP list the tools the injected runtime
// publishes through WebMCP, with no `ayme mcp` involved?
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const site = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end(readFileSync(join(root, "site/notes.html")));
}).listen(4711, "127.0.0.1");
const work = mkdtempSync(join(tmpdir(), "ayme-webmcp-"));
const config = join(work, "c.json");
writeFileSync(
  config,
  JSON.stringify({
    browser: {
      browserName: "chromium",
      isolated: true,
      launchOptions: { headless: true },
      initScript: [join(root, "dist/ayme-inject.js")],
    },
  })
);
const client = new Client({ name: "spike", version: "0" });
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [
      join(root, "node_modules/@playwright/mcp/cli.js"),
      "--config",
      config,
    ],
    cwd: root,
  })
);
const before = (await client.listTools()).tools.map((t) => t.name);
const nav = await client.callTool({
  name: "browser_navigate",
  arguments: { url: "http://127.0.0.1:4711/notes.html?webmcp" },
});
await new Promise((r) => setTimeout(r, 3000));
const after = (await client.listTools()).tools.map((t) => t.name);
console.log(
  JSON.stringify({ added: after.filter((n) => !before.includes(n)) })
);
console.log(
  nav.content
    .map((c) => c.text)
    .join("\n")
    .slice(0, 1500)
);
const ev = await client.callTool({
  name: "browser_evaluate",
  arguments: {
    function:
      "() => ({ modelContext: typeof navigator.modelContext, spike: window.__aymeSpike })",
  },
});
console.log(ev.content[0].text.slice(0, 400));
for (const name of after.filter((n) => !before.includes(n))) {
  if (/read/i.test(name))
    console.log(
      name,
      JSON.stringify(
        (await client.callTool({ name, arguments: {} })).content
      ).slice(0, 400)
    );
}
await client.close();
site.close();
process.exit(0);
