/* global console, process, setTimeout, URL */
// Drives Playwright MCP over stdio as an agent would, without an agent:
// open the page, mark the tab, attach ayme, then for each case call a
// Page Object Tool and answer its dialog with browser_handle_dialog.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const R = new URL("../../../..", import.meta.url).pathname.replace(/\/$/, "");
// A scratch folder: the log, the cache, the Playwright CLI working folder and its config.json.
const S = process.env.SPIKE_SCRATCH;
if (!S) throw new Error("Set SPIKE_SCRATCH to a scratch folder.");
const sdk = `${R}/apps/mcp-fixture/node_modules/@modelcontextprotocol/sdk/dist/esm/client`;
const { Client } = await import(`${sdk}/index.js`);
const { StdioClientTransport } = await import(`${sdk}/stdio.js`);
const LOG = `${S}/spike.log`;
const env = {
  ...process.env,
  AYME_CACHE_DIR: `${S}/cache`,
  AYME_SPIKE_LOG: LOG,
};

writeFileSync(
  `${S}/pwmcp-config.json`,
  JSON.stringify({
    browser: {
      isolated: true,
      launchOptions: { headless: true, args: ["--remote-debugging-port=9334"] },
    },
  })
);
const transport = new StdioClientTransport({
  command: `${R}/apps/eval-formbricks/node_modules/.bin/playwright-mcp`,
  args: [`--config=${S}/pwmcp-config.json`, "--headless", "--isolated"],
  cwd: S,
});
const client = new Client({ name: "dialog-spike", version: "0" });
await client.connect(transport);
const tool = async (name, args = {}) => {
  const result = await client.callTool({ name, arguments: args });
  return result.content.map((c) => c.text).join("\n");
};
const ayme = (...args) => {
  try {
    return execFileSync("node", [`${R}/packages/mcp/dist/cli.mjs`, ...args], {
      cwd: `${R}/apps/mcp-fixture/dialog-spike`,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    return `exit ${error.status}: ${(error.stdout ?? "") + (error.stderr ?? "")}`.trim();
  }
};
const events = (from) =>
  readFileSync(LOG, "utf8")
    .split("\n")
    .slice(from)
    .filter(Boolean)
    .map((l) => JSON.parse(l));
const lines = () =>
  readFileSync(LOG, "utf8").split("\n").filter(Boolean).length;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  console.log(
    (await tool("browser_navigate", { url: "http://127.0.0.1:8765/" }))
      .split("\n")
      .slice(0, 3)
      .join(" | ")
  );
  await tool("browser_evaluate", {
    function: '() => (window.__aymeMark = "spike3")',
  });
  console.log(
    ayme("attach", "--cdp", "http://127.0.0.1:9334", "--mark", "spike3")
  );
  ayme("page-objects");
  const cases = [
    ["DialogPage.confirmThenMark", { accept: false }],
    ["DialogPage.confirmThenMark", { accept: true }],
    ["DialogPage.promptThenMark", { accept: true, promptText: "Bob" }],
    ["DialogPage.alertThenMark", { accept: true }],
    ["DialogPage.confirmOwnAnswer", undefined],
  ];
  for (const [name, answer] of cases) {
    ayme("call", "DialogPage.reset");
    const from = lines();
    const call = ayme("call", name);
    let mcpSaw, handled;
    if (answer) {
      mcpSaw = (await tool("browser_snapshot"))
        .split("\n")
        .filter((l) => /dialog|Modal|Error/i.test(l))
        .join(" | ");
      handled = (await tool("browser_handle_dialog", answer))
        .split("\n")
        .filter((l) => /dialog|Error|Modal/i.test(l))
        .join(" | ");
    }
    for (
      let waited = 0;
      waited < 10_000 &&
      !events(from).some((e) => e.event === "run-end" && e.name === name);
      waited += 50
    )
      await sleep(50);
    const ev = events(from);
    const closed = ev.find((e) => e.event === "cdp-closed");
    const runEnd = ev.find((e) => e.event === "run-end" && e.name === name);
    const calls = ev
      .filter(
        (e) =>
          e.event === "call" && e.run === runEnd?.run && /action/.test(e.phase)
      )
      .map((e) => `${e.call}:${e.phase.replace(" (action)", "")}`);
    const after = (await tool("browser_snapshot"))
      .split("\n")
      .filter((l) => /result:|marks:|Modal|dialog/.test(l))
      .map((l) => l.trim())
      .join(" ; ");
    console.log(
      JSON.stringify({
        name,
        answer,
        call: call.slice(0, 90),
        mcpSaw,
        handled,
        cdpClosed: closed && {
          result: closed.result,
          userInput: closed.userInput,
          reported: closed.reported,
        },
        calls: calls.join(", "),
        answeredToMethodEndMs: ev.find(
          (e) => e.event === "method-end" && e.run === runEnd?.run
        )?.answeredToMethodEndMs,
        afterMcp: after,
      })
    );
  }
} finally {
  console.log(ayme("detach"));
  await tool("browser_close").catch(() => {});
  await client.close();
}
