// Against the real apps/example-react dev server: the browser runtime's published Page Object Tools
// (read through the recording WebMCP driver of @ayme-dev/ayme/testing) versus the Node probe.
import { livePageObjectTools, type Registration } from "./probe.ts";
import type { Locator, Page } from "playwright";

const ROOT = "/tmp/claude-0/-home-claude/9aad7f33-7b4d-5a05-916f-be31ec76afec/scratchpad/liveness";
const { chromium } = await import(`${ROOT}/ayme/apps/example-react/node_modules/playwright/index.mjs`);
const { recordPublishedTools, publishedToolNames } = await import(`${ROOT}/ayme/packages/ayme/dist/testing.mjs`);
const URL_ = "http://127.0.0.1:4191/";

// The shipped CounterPage (apps/example-react/playwright/pom/CounterPage.ts) has no root. The pilot's
// copy adds one at the <section aria-label="Counter">, as the e2e prototype did on Abel's machine.
class CounterPage {
  readonly root: Locator; readonly incrementButton: Locator;
  constructor(page: Page) { this.root = page.getByRole("region", { name: "Counter" }); this.incrementButton = this.root.getByRole("button", { name: "Increment", exact: true }); }
  async increment() { await this.incrementButton.click(); }
}
const emptyInput = { type: "object", properties: {}, required: [], additionalProperties: false };
const counterTool = { methodName: "increment", toolName: "CounterPage.increment", description: "Increment the counter.", inputSchema: emptyInput, parameters: [] };
const rooted: Registration = { manifest: { className: "CounterPage", members: [{ memberName: "root", kind: "locator", access: "field" }, { memberName: "incrementButton", kind: "locator", access: "field" }], components: [], tools: [counterTool] }, instance: null as unknown as object };
const rootless: Registration = { manifest: { className: "CounterPage", members: [{ memberName: "incrementButton", kind: "locator", access: "field" }], components: [], tools: [counterTool] }, instance: null as unknown as object };

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
await recordPublishedTools(context);
const page: Page = await context.newPage();
for (let attempt = 0; ; attempt++) {
  try { await page.goto(URL_, { waitUntil: "load" }); break; } catch (e) { if (attempt > 60) throw e; await new Promise(r => setTimeout(r, 1000)); }
}
rooted.instance = new CounterPage(page); rootless.instance = rooted.instance;
const pageObjectTools = async () => ((await publishedToolNames(page)) as string[]).filter((n) => /^[A-Z]\w*\./.test(n));
const until = async (pred: (names: string[]) => boolean, what: string) => {
  const deadline = Date.now() + 15_000;
  for (;;) { const names = await pageObjectTools(); if (pred(names)) return names; if (Date.now() > deadline) throw new Error(`timeout waiting for ${what}; published: ${names}`); await new Promise(r => setTimeout(r, 50)); }
};
async function compare(label: string, settle?: (names: string[]) => boolean) {
  await new Promise(r => setTimeout(r, 150)); // let the runtime's coalesced probe run (registry.ts:257-264)
  const browserTools = settle ? await until(settle, label) : await pageObjectTools();
  const node = await livePageObjectTools(page, [rooted]);
  const nodeRootless = await livePageObjectTools(page, [rootless]);
  const r = node.poms[0]!;
  console.log(`\n== ${label} ==`);
  console.log(`  browser runtime publishes:            ${browserTools.join(", ") || "-"}   (shipped CounterPage: no root)`);
  console.log(`  node probe, pilot CounterPage w/ root: ${r.liveTools.join(", ") || "-"}   (matches=${r.matches} present=${r.present} available=${r.available}; ${node.timings.totalMs.toFixed(1)} ms)`);
  console.log(`  node probe, shipped manifest (no root): ${nodeRootless.poms[0]!.liveTools.join(", ")}   (registration gate: declared = live)`);
}
await compare("initial: counter mounted", (n) => n.includes("CounterPage.increment"));
await page.getByRole("button", { name: "Unmount counter" }).click();
await compare("after 'Unmount counter'", (n) => !n.includes("CounterPage.increment"));
await page.getByRole("button", { name: "Mount counter" }).click();
await compare("after 'Mount counter'", (n) => n.includes("CounterPage.increment"));
await page.evaluate(() => { const d = document.createElement("dialog"); d.id = "pilot-modal"; d.textContent = "A modal injected by the pilot"; document.body.append(d); d.showModal(); });
await compare("with an injected modal dialog open");
await page.evaluate(() => document.getElementById("pilot-modal")?.remove());
await compare("modal removed");
await browser.close();
