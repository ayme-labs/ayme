// Pilot of the proposed module: "which top-level Page Object Tools are live right now", answered
// against any Playwright-compatible Page (Playwright in Node, playwright-lite in the page) with one
// evaluation of the browser runtime's own liveness definition per check.
import type { ElementHandle, Locator, Page } from "playwright";
import { observeRootsInPage, type PomRootState } from "./inPage.ts";

/** Subset of PomManifest (packages/ayme/src/contracts.ts:72-78) the probe reads. */
export type PomManifest = {
  className: string;
  members: readonly { memberName: string; kind: "locator" | "component"; access: "field" | "getter" | "method" }[];
  components: readonly unknown[];
  tools: readonly { methodName: string; toolName: string; description: string; inputSchema: unknown; parameters: readonly unknown[] }[];
};

export type Registration = { manifest: PomManifest; instance: object };

export type PomLiveness = {
  className: string;
  /** "root": the root decides; "registration": no root declared, live while registered. */
  gate: "root" | "registration";
  matches?: number;
  present?: boolean;
  available?: boolean;
  liveTools: string[];
};

export type LivenessAnswer = { poms: PomLiveness[]; timings: { resolveMs: number; evaluateMs: number; inPageMs: number; totalMs: number } };

const now = () => performance.now();

function declaresRoot(manifest: PomManifest) {
  // The same test the registry applies: packages/ayme/src/registry.ts:434-436 and 812-814.
  return manifest.members.some((m) => m.kind === "locator" && m.memberName === "root");
}

function isLocator(value: unknown): value is Locator {
  return typeof value === "object" && value !== null && typeof (value as Locator).elementHandles === "function";
}

/**
 * One check. Resolves every declared root to its element handles in parallel (N cheap calls),
 * then evaluates the liveness definition once for all of them. A root with != 1 match is
 * absent (ambiguous roots establish nothing: ADR-0020).
 */
export async function livePageObjectTools(page: Page, registrations: readonly Registration[]): Promise<LivenessAnswer> {
  const started = now();
  const rooted = registrations.filter((r) => declaresRoot(r.manifest));
  const handleLists = await Promise.all(
    rooted.map(async ({ instance }) => {
      const root = Reflect.get(instance, "root");
      return isLocator(root) ? root.elementHandles() : [];
    })
  );
  const resolved = now();
  const singles: (ElementHandle | null)[] = handleLists.map((list) => (list.length === 1 ? list[0]! : null));
  let states: PomRootState[] = [];
  let inPageMs = 0;
  try {
    ({ states, inPageMs } = await page.evaluate(observeRootsInPage, singles as unknown as (Element | null)[]));
  } finally {
    await Promise.all(handleLists.flat().map((h) => h.dispose()));
  }
  const evaluated = now();
  const byClass = new Map(rooted.map((r, i) => [r.manifest.className, { matches: handleLists[i]!.length, ...states[i]! }]));
  const poms = registrations.map(({ manifest }): PomLiveness => {
    const tools = manifest.tools.map((t) => t.toolName);
    const root = byClass.get(manifest.className);
    if (!root) return { className: manifest.className, gate: "registration", liveTools: tools };
    return { className: manifest.className, gate: "root", ...root, liveTools: root.available ? tools : [] };
  });
  return { poms, timings: { resolveMs: resolved - started, evaluateMs: evaluated - resolved, inPageMs, totalMs: evaluated - started } };
}

/** The browser runtime's shape for comparison: count, isVisible, evaluate, per root, in sequence (pomReachability.ts:14-16). */
export async function livePageObjectToolsSequential(page: Page, registrations: readonly Registration[]) {
  const started = now();
  const out: PomLiveness[] = [];
  for (const { manifest, instance } of registrations) {
    const tools = manifest.tools.map((t) => t.toolName);
    if (!declaresRoot(manifest)) { out.push({ className: manifest.className, gate: "registration", liveTools: tools }); continue; }
    const root = Reflect.get(instance, "root") as Locator;
    let state: PomRootState = { present: false, available: false };
    const matches = await root.count();
    if (matches === 1 && (await root.isVisible())) {
      // The runtime's locator.evaluate resolves the element itself (3 round trips); here a handle is
      // taken explicitly, so this variant pays one more.
      const handle = await root.elementHandle();
      if (handle) {
        state = (await page.evaluate(observeRootsInPage, [handle] as unknown as (Element | null)[])).states[0]!;
        await handle.dispose();
      }
    }
    out.push({ className: manifest.className, gate: "root", matches, ...state, liveTools: state.available ? tools : [] });
  }
  return { poms: out, totalMs: now() - started };
}
