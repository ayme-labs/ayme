import { selectors } from "@ayme-dev/playwright-lite";
import { parseStructuralRef } from "@ayme-dev/core/structural-observation";
import { latestPageStateElement } from "./pageState";

/** The engine's name, the one core's Structural Ref grammar writes as `ayme-ref=…`. */
const ENGINE_NAME = "ayme-ref";
/** The page-world global the engine reads a ref's element through. */
const LOOKUP_GLOBAL = "__aymeRefElement";

type RefLookup = (
  currentDocument: Document,
  ref: string
) => Element | undefined;

/** The element the latest capture of the document's Page State Session maps `ref` to. */
const lookup: RefLookup = (currentDocument, ref) => {
  const structuralRef = parseStructuralRef(ref);
  return (
    structuralRef && latestPageStateElement(currentDocument, structuralRef)
  );
};

// Stryker disable all
/**
 * The engine, evaluated in the page's own JavaScript world, where nothing of
 * this package is in scope, `LOOKUP_GLOBAL` included: it reaches the lookup
 * through the global alone, by name.
 */
const refSelectorEngine = () => {
  // `root` holds the element when it is an ancestor across shadow roots,
  // which `Node.contains` does not cross.
  const holds = (root: Node, element: Element): boolean => {
    for (let node: Node | null = element; node;)
      if (node === root) return true;
      else node = node instanceof ShadowRoot ? node.host : node.parentNode;
    return false;
  };
  const find = (root: Node, ref: string): Element | undefined => {
    const lookup = (globalThis as { __aymeRefElement?: RefLookup })
      .__aymeRefElement;
    const element = lookup?.(root.ownerDocument ?? (root as Document), ref);
    return element && holds(root, element) ? element : undefined;
  };
  return {
    query: (root: Node, ref: string) => find(root, ref) ?? null,
    queryAll: (root: Node, ref: string) => {
      const element = find(root, ref);
      return element ? [element] : [];
    },
  };
};
// Stryker restore all

let registered = false;

/**
 * Package-internal: registers `ayme-ref`, the selector engine that resolves
 * a Structural Ref to the element the current capture maps it to (ADR-0038),
 * so `page.locator("ayme-ref=e5")` acts on any ref a capture prints,
 * synthetic or not. Registered once: a second registration of the name is
 * refused by the selectors registry.
 */
export function registerRefSelectorEngine(): void {
  if (registered) return;
  registered = true;
  (globalThis as { [LOOKUP_GLOBAL]?: RefLookup })[LOOKUP_GLOBAL] = lookup;
  // Registration completes synchronously; the promise only reports a name
  // this guard already excludes.
  void selectors.register(ENGINE_NAME, refSelectorEngine);
}
