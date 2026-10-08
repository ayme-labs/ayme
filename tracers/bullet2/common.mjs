// Shared bits for bullet 2: imports, fixture injection, ai-mode bridge, Change Record rendering.
export { chromium } from "../../packages/ayme/node_modules/playwright/index.mjs";
export {
  recordPublishedTools, publishedToolNames, waitForPublishedTool, executePublishedTool,
} from "../../packages/ayme/dist/testing.mjs";
import {
  AriaRefSchema, StructuralNode, StructuralTree, SyntheticAriaRefFactory,
  projectStructuralNodeForest, renderCompactStructuralNodeForest,
} from "../../packages/core/dist/index.mjs";
export * from "../../packages/core/dist/index.mjs";

export const BASE = "http://127.0.0.1:4191/";

// Fixtures example-react lacks, injected the same way on both sides, outside React's #root.
export async function injectFixtures(page) {
  await page.evaluate(() => {
    const box = document.createElement("div");
    box.id = "bullet2-fixture";
    box.innerHTML = `<button id="b2-nav">Navigate with query</button>
      <button id="b2-disabled" disabled>Disabled action</button>
      <p id="b2-para">Plain paragraph</p>`;
    box.querySelector("#b2-nav").addEventListener("click", () => {
      location.href = location.href + "&nav=1";
    });
    document.body.append(box);
  });
}

// The bridge: Playwright ai-mode YAML -> core StructuralTree, mirroring ayme's parseCapturedTree
// (ref-less nodes get temporary refs, then are dropped and their children promoted).
export function parseCapturedTree(yaml, refFactory) {
  const temporaryRefs = new Set();
  let counter = 0;
  const parsed = StructuralTree.fromAriaSnapshotYaml(yaml, {
    create() {
      let ref;
      do ref = AriaRefSchema.parse(`s_webmcp_parse_${++counter}`);
      while (yaml.includes(`[ref=${ref}]`));
      temporaryRefs.add(ref);
      return ref;
    },
  });
  const select = (node) => {
    const children = node.children.flatMap((c) => (typeof c === "string" ? [c] : select(c)));
    return temporaryRefs.has(node.ref) ? children : [node.copy({ children })];
  };
  const roots = parsed.root.role === "fragment" && parsed.root.ref === "s_root"
    ? parsed.root.children.flatMap((c) => (typeof c === "string" ? [c] : select(c)))
    : select(parsed.root);
  const only = roots[0];
  return new StructuralTree(
    roots.length === 1 && typeof only !== "string" && only !== undefined
      ? only
      : new StructuralNode({ ref: AriaRefSchema.parse("s_root"), role: "fragment", name: "", cursorPointer: false, children: roots }),
    refFactory,
  );
}

// Port of packages/ayme/src/changeRecord.ts (not exported from dist).
export function renderChangeRecord(reconciled) {
  const changed = new Set();
  reconciled.walk((n) => {
    const k = n.status?.kind;
    if (k === "added" || k === "removed" || k === "updated") changed.add(n.ref);
  });
  if (changed.size === 0) return "";
  const cache = new Map();
  const below = (n) => {
    if (cache.has(n.ref)) return cache.get(n.ref);
    const r = changed.has(n.ref) || n.children.some((c) => typeof c !== "string" && below(c));
    cache.set(n.ref, r);
    return r;
  };
  const projected = projectStructuralNodeForest(
    {
      roots: reconciled.getRootNodes().filter(below),
      structuralNode: (n) => n,
      children: (n) => {
        const s = n.status;
        const withText = s?.kind === "added" || s?.kind === "removed" || (s?.kind === "updated" && s.selfChanged);
        return n.children.filter((c) => (typeof c === "string" ? withText : below(c)));
      },
    },
    { includeIdentity: false, includeStatus: true, prefixes: (n) => [n.ref] },
  );
  return renderCompactStructuralNodeForest(projected);
}

export function renderTreeText(tree) {
  return renderCompactStructuralNodeForest(projectStructuralNodeForest(
    { roots: tree.getRootNodes(), structuralNode: (n) => n, children: (n) => n.children },
    { includeIdentity: false, includeStatus: false, prefixes: (n) => [n.ref] },
  ));
}

export async function aiCapture(page, refFactory) {
  const yaml = await page.ariaSnapshot({ mode: "ai" });
  const tree = parseCapturedTree(yaml, refFactory);
  const dup = tree.findDuplicateRef();
  if (dup !== null) throw new Error(`duplicate ref ${dup}`);
  return { yaml, tree };
}

export async function openBrowserPage(browser, tag) {
  const context = await browser.newContext();
  await recordPublishedToolsLocal(context);
  const page = await context.newPage();
  await page.goto(`${BASE}?bullet2=${tag}`);
  await waitForPublishedToolLocal(page, "CounterPage.increment");
  await injectFixtures(page);
  return { context, page };
}
import { recordPublishedTools as rpt, waitForPublishedTool as wpt } from "../../packages/ayme/dist/testing.mjs";
const recordPublishedToolsLocal = rpt, waitForPublishedToolLocal = wpt;
