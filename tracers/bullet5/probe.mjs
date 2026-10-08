// One look: tools, snapshot text, marks, mint attribution, Inspector state.
import { writeFileSync } from "node:fs";
import { open, captureFn, WT } from "./common.mjs";

const s = await open();
const out = {};
try {
  const { page, agent } = s;
  const { tools } = await agent.client.listTools();
  out.tools = tools.map((t) => t.name);
  out.clickSchema = tools.find((t) => t.name === "click")?.inputSchema;
  out.snapshotSchema = tools.find((t) => t.name === "snapshot")?.inputSchema;
  out.addItemSchema = tools.find((t) => t.name === "ListPage.addItem")?.inputSchema;
  out.mints = await page.evaluate(() => window.__aymeTracer.mints.length);
  out.mintsBy = await page.evaluate(() => window.__aymeTracer.mints.reduce((a, m) => ((a[m.by] = (a[m.by] ?? 0) + 1), a), {}));
  out.maxPageRef = await page.evaluate(() => Math.max(...window.__aymeTracer.mints.map((m) => +m.ref.replace(/\D/g, ""))));
  out.stackSample = await page.evaluate(() => window.__aymeTracer.mints.filter((m) => m.stack).map((m) => m.by + " " + m.ref + " " + m.stack));
  out.snapshot = (await agent.call("snapshot", {})).text;
  const n = await page.evaluate(captureFn);
  out.node = { distilled: n.distilled, dupes: n.dupes };
  out.inspectorHost = await page.evaluate(() => [...document.body.children].map((e) => e.tagName + " " + [...e.attributes].map((a) => a.name).join(",")));
  out.errors = s.errors;
} finally {
  await s.close();
}
writeFileSync(`${WT}/tracers/bullet5/out/probe.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2).slice(0, 6000));
