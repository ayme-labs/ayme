// The same liveness definition, run through playwright-lite inside the page: (a) via the lite Page's
// own elementHandles + evaluate, exactly as the Node side does on Playwright; (b) as a direct call
// with the fork's resolveLocatorElements, as the browser runtime would call it (no serialization).
import { observeRootsInPage } from "./inPage.ts";
import { classes, manifests } from "./poms.ts";
import { livePageObjectTools, type Registration } from "./probe.ts";
import { ORIGIN, serve } from "./serve.ts";

const ROOT = "/tmp/claude-0/-home-claude/9aad7f33-7b4d-5a05-916f-be31ec76afec/scratchpad/liveness";
const { chromium } = await import(`${ROOT}/ayme/apps/example-react/node_modules/playwright/index.mjs`);
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
page.on("console", (m: { text(): string }) => console.log("  [page]", m.text()));
await serve(page, { pilot: `${ROOT}/pilot`, lite: `${ROOT}/ayme/packages/ayme/node_modules/@ayme-dev/playwright-lite/dist` });
await page.goto(`${ORIGIN}/pilot/fixture.html`);
await page.addScriptTag({ type: "module", content: `
  import { createPage } from "${ORIGIN}/lite/index.mjs";
  import { resolveLocatorElements } from "${ORIGIN}/lite/internal.mjs";
  window.__lite = { page: createPage(), resolveLocatorElements };` });
await page.waitForFunction(() => (window as any).__lite);

const roots: [string, string][] = [["region", "Counter"], ["region", "Projects"], ["dialog", "Archive item"], ["complementary", "Sidebar"]];
const registrations: Registration[] = Object.entries(classes).filter(([n]) => n !== "StatusPage").map(([name, C]) => ({ manifest: manifests[name]!, instance: new C(page) }));

async function compare(label: string) {
  const lite = await page.evaluate(async ({ source, roots }) => {
    const { page: lite, resolveLocatorElements } = (window as any).__lite;
    const fn = new Function(`return (${source})`)();
    const locators = roots.map(([role, name]) => lite.getByRole(role, { name }));
    // (a) through the lite Page: handles, then one evaluate
    let t0 = performance.now();
    const lists = await Promise.all(locators.map((l: any) => l.elementHandles()));
    const singles = lists.map((l: any[]) => (l.length === 1 ? l[0] : null));
    const viaEvaluate = await lite.evaluate(fn, singles);
    const evaluateMs = performance.now() - t0;
    // (b) direct call, as the browser runtime would do it
    t0 = performance.now();
    const elements = locators.map((l: any) => { const els = resolveLocatorElements(l); return els.length === 1 ? els[0] : null; });
    const direct = fn(elements);
    const directMs = performance.now() - t0;
    return { viaEvaluate: viaEvaluate.states, evaluateMs, direct: direct.states, directMs };
  }, { source: observeRootsInPage.toString(), roots });
  const node = await livePageObjectTools(page, registrations);
  console.log(`\n== ${label} ==`);
  roots.forEach(([, name], i) => {
    const n = node.poms[i]!; const a = lite.viaEvaluate[i]!; const d = lite.direct[i]!;
    const same = n.present === a.present && n.available === a.available && a.present === d.present && a.available === d.available;
    console.log(`  ${name.padEnd(13)} node(playwright) p=${n.present} a=${n.available} | lite.evaluate p=${a.present} a=${a.available} | lite direct p=${d.present} a=${d.available}  ${same ? "agree" : "DIFFER"}`);
  });
  console.log(`  ms: node ${node.timings.totalMs.toFixed(1)} | lite via evaluate ${lite.evaluateMs.toFixed(1)} | lite direct call ${lite.directMs.toFixed(1)}`);
}
await compare("initial");
await page.getByRole("button", { name: "Archive" }).click();
await compare("modal dialog open");
await page.keyboard.press("Escape");
await page.getByRole("button", { name: "Unmount counter" }).click();
await page.getByRole("button", { name: "Open sidebar" }).click();
await compare("counter unmounted, sidebar open");
await browser.close();
