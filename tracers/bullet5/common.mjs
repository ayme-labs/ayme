// Tracer bullet 5: shared setup. Real Playwright page with our Node-injected InjectedScript copy,
// the inspector-fixture dogfood page, and an `ayme mcp` agent connected to the same page.
import { readFileSync } from "node:fs";
import { chromium, selectors } from "../../packages/ayme/node_modules/playwright/index.mjs";
import { startAgent, connectPage, freePort, ignoreAutoPairScan } from "../../packages/mcp/dist/testing.mjs";

export const WT = decodeURIComponent(new URL("../..", import.meta.url).pathname).replace(/\/$/, "");
export const PORT = Number(process.env.FIXTURE_PORT ?? 4791);

const tsFile = readFileSync(`${process.env.PLAYWRIGHT_LITE_DIR}/build/generated/injectedScriptSource.ts`, "utf8");
const ORIGINAL = JSON.parse(tsFile.slice(tsFile.indexOf('"'), tsFile.lastIndexOf('"') + 1));
const MINT = '"e" + ++lastRef';
if (ORIGINAL.split(MINT).length !== 2) throw new Error("mint site not found exactly once");
// Fix probe: the counter lives on the page under a Symbol.for key, shared by every copy patched the same way.
const SHARED = ORIGINAL.replace(MINT, '"e" + (window[Symbol.for("ayme.ariaRefCounter")] = (window[Symbol.for("ayme.ariaRefCounter")] ?? 0) + 1)');

// variant: "plain" | "shared" | "prefix7"
export function bootstrap(variant) {
  const source = variant === "shared" ? SHARED : ORIGINAL;
  const options = { browserName: "chromium", customEngines: [], frameSeq: variant === "prefix7" ? 7 : 0, isUnderTest: false, isUtilityWorld: false, sdkLanguage: "javascript", shouldPrependErrorPrefix: false, stableRafCount: 0, testIdAttributeName: "data-testid" };
  return `(() => {
  const module = { exports: {} };
  ${source}
  const IS = module.exports.InjectedScript();
  window.__aymeTracer = { injected: new IS(window, ${JSON.stringify(options)}), refs: new Map(), mints: [], sawNode: 0 };
  // Instrumentation: record the first assignment of _ariaRef on each element, with the minting copy.
  // The page's copy is served from .../packages/ayme/dist/...; ours is evaluated from this init script.
  Object.defineProperty(Element.prototype, "_ariaRef", {
    configurable: true,
    set(v) {
      Object.defineProperty(this, "_ariaRef", { value: v, writable: true, configurable: true, enumerable: false });
      const stack = new Error().stack || "";
      const by = /packages\\/ayme\\/dist|playwright-lite|\\/node_modules\\//.test(stack) ? "page" : "node";
      window.__aymeTracer.mints.push({ t: performance.now(), ref: v.ref, by, stack: window.__aymeTracer.mints.length < 3 || by === "node" && !window.__aymeTracer.sawNode++ ? stack.split("\\n").slice(1, 6).join(" | ") : undefined, tag: this.tagName, role: v.role, name: String(v.name).slice(0, 40) });
    },
  });
})();`;
}

const AYME_REF = "({ query(root, sel) { return window.__aymeTracer?.refs.get(sel) ?? null; }, queryAll(root, sel) { const e = window.__aymeTracer?.refs.get(sel); return e ? [e] : []; } })";
let registered = false;

// Node capture: fills refs (ref -> element, last one wins, as a Map built from refsByElement does).
export const captureFn = () => {
  const t = window.__aymeTracer;
  const r = t.injected.captureAriaSnapshot(document.body);
  const refs = new Map();
  const byRef = {};
  for (const [el, ref] of r.refsByElement) {
    refs.set(ref, el);
    (byRef[ref] ??= []).push(el);
  }
  t.refs = refs;
  const describe = (el) => `${el.tagName.toLowerCase()}${el.getAttribute("aria-label") ? `[aria-label=${el.getAttribute("aria-label")}]` : ""} "${(el.textContent || "").trim().slice(0, 30)}"`;
  const dupes = Object.entries(byRef).filter(([, els]) => els.length > 1).map(([ref, els]) => ({ ref, elements: els.map(describe), resolvesTo: describe(refs.get(ref)) }));
  return { distilled: r.distilledText, full: r.fullText, dupes, t: performance.now() };
};

// Core's Settled Page: 250 ms without DOM mutation (document subtree) or animation/scroll events, 2 s deadline.
export const waitSettledFn = () => new Promise((resolve) => {
  const quietMs = 250, deadlineMs = 2000, start = performance.now();
  let last = start, timer;
  const events = ["transitionrun", "transitionstart", "transitionend", "transitioncancel", "animationstart", "animationiteration", "animationend", "animationcancel", "scroll", "resize"];
  const done = (stable) => { obs.disconnect(); for (const e of events) document.removeEventListener(e, on, true); clearTimeout(timer); clearTimeout(dl); resolve({ stable, ms: performance.now() - start, t: performance.now() }); };
  const check = () => { clearTimeout(timer); const rem = quietMs - (performance.now() - last); if (rem <= 0) return done(true); timer = setTimeout(check, rem); };
  const on = () => { last = performance.now(); check(); };
  const obs = new MutationObserver(on);
  obs.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  for (const e of events) document.addEventListener(e, on, true);
  const dl = setTimeout(() => done(false), deadlineMs);
  check();
});

export const refTokens = (text) => [...text.matchAll(/\[ref=([^\]]+)\]/g)].map((m) => m[1]);
export const dupTokens = (text, re = /\[ref=([^\]]+)\]/g) => { const c = {}; for (const m of text.matchAll(re)) c[m[1]] = (c[m[1]] ?? 0) + 1; return Object.entries(c).filter(([, n]) => n > 1).map(([r]) => r); };
// The runtime's structure text puts the ref first: "e12 button \"Add item\"".
export const structureRefs = (text) => [...text.matchAll(/^\s*- ((?:f\d+)?e\d+)\b/gm)].map((m) => m[1]);

export async function open({ variant = "plain", path = "/dogfood.html", agent: withAgent = true, inspector = true } = {}) {
  if (!registered) { await selectors.register("ayme-ref", { content: AYME_REF }); registered = true; }
  const browser = await chromium.launch();
  const context = await browser.newContext();
  await ignoreAutoPairScan(context);
  await context.addInitScript(bootstrap(variant));
  if (!inspector) {
    // Control: the same dogfood page with the Inspector never mounted. Only the served startAyme.ts response is
    // rewritten in this browser context; no file changes.
    await context.route(/\/startAyme\.ts(\?|$)/, async (route) => {
      const res = await route.fetch();
      const body = await res.text();
      const MOUNT = 'mount === "before" ? mountInspector({';
      if (!body.includes(MOUNT)) throw new Error("startAyme.ts mount site not found");
      await route.fulfill({ response: res, body: body.replace(MOUNT, "false ? mountInspector({") });
    });
  }
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const url = `http://127.0.0.1:${PORT}${path}`;
  let agent;
  if (withAgent) {
    agent = await startAgent("--port", String(await freePort()));
    await connectPage(agent, page, url, { timeout: 60_000 });
  } else {
    await page.goto(url);
  }
  await page.waitForFunction(() => document.documentElement.dataset.fixture === "ready", null, { timeout: 60_000 });
  await page.waitForTimeout(1500);
  const close = async () => { try { await agent?.close(); } finally { await browser.close(); } };
  return { browser, context, page, agent, errors, close };
}
