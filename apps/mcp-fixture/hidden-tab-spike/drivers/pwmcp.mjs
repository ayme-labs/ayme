/* global console, process */
// Starts Playwright MCP over stdio as an agent would, opens the test page,
// marks the tab and attaches ayme, then runs case.mjs with the given cases
// while the MCP client keeps the browser.
// Usage: node pwmcp.mjs "<way> <step>" ...
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

import { R, S, ayme, env } from "./lib.mjs";

const sdk = `${R}/apps/mcp-fixture/node_modules/@modelcontextprotocol/sdk/dist/esm/client`;
const { Client } = await import(`${sdk}/index.js`);
const { StdioClientTransport } = await import(`${sdk}/stdio.js`);
writeFileSync(
  `${S}/pwmcp-config.json`,
  JSON.stringify({
    browser: {
      isolated: true,
      launchOptions: { headless: true, args: ["--remote-debugging-port=9344"] },
    },
  })
);
const transport = new StdioClientTransport({
  command: `${R}/apps/eval-formbricks/node_modules/.bin/playwright-mcp`,
  args: [`--config=${S}/pwmcp-config.json`, "--headless", "--isolated"],
  cwd: S,
});
const client = new Client({ name: "hidden-tab-spike", version: "0" });
await client.connect(transport);
const tool = async (name, args = {}) =>
  (await client.callTool({ name, arguments: args })).content
    .map((c) => c.text)
    .join("\n");
try {
  await tool("browser_navigate", { url: "http://127.0.0.1:8766/" });
  await tool("browser_evaluate", {
    function: '() => (window.__aymeMark = "ht5")',
  });
  console.log(
    ayme("attach", "--cdp", "http://127.0.0.1:9344", "--mark", "ht5").out
  );
  for (const c of process.argv.slice(2))
    console.log(
      execFileSync(
        "node",
        [
          `${R}/apps/mcp-fixture/hidden-tab-spike/drivers/case.mjs`,
          "http://127.0.0.1:9344",
          ...c.split(" "),
          "3",
          "6000",
        ],
        { env, encoding: "utf8" }
      ).trim()
    );
} finally {
  console.log(ayme("detach").out);
  await client.close();
}
