import { selectors } from "@ayme-dev/playwright-lite";
import { parseStructuralRef } from "@ayme-dev/core/structural-observation";
import { latestPageStateElement } from "./pageState";

/** The engine's name, the one core's Structural Ref grammar writes as `ayme-ref=…`. */
const ENGINE_NAME = "ayme-ref";

/** The element the latest capture of the document's Page State Session maps `ref` to. */
function lookup(currentDocument: Document, ref: string): Element | undefined {
  const structuralRef = parseStructuralRef(ref);
  return (
    structuralRef && latestPageStateElement(currentDocument, structuralRef)
  );
}

/**
 * `root` holds `element` when it is an ancestor across shadow roots, which
 * `Node.contains` does not cross.
 */
function holds(root: Node, element: Element): boolean {
  for (let node: Node | null = element; node;)
    if (node === root) return true;
    else node = node instanceof ShadowRoot ? node.host : node.parentNode;
  return false;
}

function find(root: Node, ref: string): Element | undefined {
  const element = lookup(root.ownerDocument ?? (root as Document), ref);
  return element && holds(root, element) ? element : undefined;
}

/**
 * The engine. playwright-lite calls the function as it is, in the page's one
 * JavaScript world, so it keeps this module in scope and needs no `eval`: it
 * registers on a page whose Content Security Policy forbids one.
 */
const refSelectorEngine = () => ({
  query: (root: Node, ref: string) => find(root, ref) ?? null,
  queryAll: (root: Node, ref: string) => {
    const element = find(root, ref);
    return element ? [element] : [];
  },
});

// On the global object, not in this module: the selectors registry outlives
// a reload of this module (as a test's `vi.resetModules` does), and refuses a
// second registration of the name.
const REGISTERED = Symbol.for("ayme.refSelectorEngine.registered");
const registry = globalThis as { [REGISTERED]?: true };

/**
 * Package-internal: registers `ayme-ref`, the selector engine that resolves
 * a Structural Ref to the element the current capture maps it to (ADR-0038),
 * so `page.locator("ayme-ref=e5")` acts on any ref a capture prints,
 * synthetic or not. Registered once: a second registration of the name is
 * refused by the selectors registry.
 */
export function registerRefSelectorEngine(): void {
  if (registry[REGISTERED]) return;
  registry[REGISTERED] = true;
  // Registration completes synchronously; the promise only reports a name
  // this guard already excludes.
  void selectors.register(ENGINE_NAME, refSelectorEngine);
}
