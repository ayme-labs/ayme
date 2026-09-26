import type { AriaRef } from "@ayme-dev/webmcp";
import { getPageStateForElements } from "@ayme-dev/webmcp/internal";

import type { StructureNode } from "./structure";
import { errorMessage } from "./useInspector";

/** The Inspector's own host element on the page. */
const inspectorHost = "[data-ayme-inspector-host]";

/**
 * Which nodes of the structure a tool can use, by the tool's name: undefined
 * when it can use every node. The runtime keeps each Ref tool's element
 * filter to itself for now, so every tool can use every node.
 */
export function refFilterOf(
  toolName: string
): ((node: StructureNode & { ref: string }) => boolean) | undefined {
  void toolName;
  return undefined;
}

/** How picking a ref on the page ends: with the ref picked, or none. */
export type RefPickingHandlers = {
  /** Whether a ref can be picked. The element of one that can't isn't highlighted. */
  accept: (ref: string) => boolean;
  /** Called once: with the ref clicked, or with none when Esc cancels. */
  onEnd: (ref: string | undefined) => void;
};

/**
 * Picks a ref by pointing at the page. The element under the pointer that
 * carries a ref is highlighted, a click picks it and Esc cancels. The page
 * doesn't act on those presses; the Inspector's own elements are left alone.
 *
 * @returns stops picking without calling `onEnd`.
 */
export function startRefPicking({
  accept,
  onEnd,
}: RefPickingHandlers): () => void {
  const refs = refsOnPage();
  let known: ReadonlyMap<Element, string> | undefined;
  void refs.then((map) => (known = map));
  const highlight = new OwnHighlight();
  let stopped = false;

  /** The element and ref an event points at, when a ref there can be picked. */
  const pointedAt = (event: Event, map: ReadonlyMap<Element, string>) => {
    for (
      let element = event.composedPath()[0] as Element | null;
      element instanceof Element;
      element = parentOf(element)
    ) {
      const ref = map.get(element);
      if (ref !== undefined) return accept(ref) ? { element, ref } : undefined;
    }
  };

  const onMove = (event: PointerEvent) => {
    if (isInspectors(event) || !known) return highlight.set(undefined);
    highlight.set(pointedAt(event, known)?.element);
  };
  // Presses on the page pick; the page itself never sees them.
  const block = (event: Event) => {
    if (isInspectors(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const onClick = (event: MouseEvent) => {
    if (isInspectors(event)) return;
    block(event);
    void refs.then((map) => {
      const picked = pointedAt(event, map);
      if (picked && !stopped) end(picked.ref);
    });
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    end(undefined);
  };

  const blocked = ["pointerdown", "mousedown", "pointerup", "mouseup"];
  const stop = () => {
    if (stopped) return;
    stopped = true;
    window.removeEventListener("pointermove", onMove, true);
    window.removeEventListener("click", onClick, true);
    window.removeEventListener("keydown", onKey, true);
    for (const type of blocked) window.removeEventListener(type, block, true);
    highlight.set(undefined);
  };
  const end = (ref: string | undefined) => {
    stop();
    onEnd(ref);
  };

  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("click", onClick, true);
  window.addEventListener("keydown", onKey, true);
  for (const type of blocked) window.addEventListener(type, block, true);
  return stop;
}

const preview = { highlight: undefined as OwnHighlight | undefined, id: 0 };

/** Highlights a ref's element on the page while it's there. */
export async function previewRef(ref: string) {
  clearRefPreview();
  const id = preview.id;
  try {
    const { state } = await getPageStateForElements([]);
    const [resolution] = await state.resolve(ref as AriaRef);
    if (id !== preview.id || resolution?.status !== "resolved") return;
    preview.highlight = new OwnHighlight();
    preview.highlight.set(resolution.node.element);
  } catch (error) {
    console.warn(`Could not highlight ${ref}: ${errorMessage(error)}`);
  }
}

export function clearRefPreview() {
  preview.id += 1;
  preview.highlight?.set(undefined);
  preview.highlight = undefined;
}

/** The ref of each element on the page that has one, from one capture. */
async function refsOnPage(): Promise<ReadonlyMap<Element, string>> {
  const elements = [...document.body.querySelectorAll("*")].filter(
    (element) => !element.closest(inspectorHost)
  );
  const map = new Map<Element, string>();
  try {
    const { refs } = await getPageStateForElements(elements);
    elements.forEach((element, index) => {
      const ref = refs[index];
      if (ref !== undefined) map.set(element, ref);
    });
  } catch (error) {
    console.warn(`Could not read the page's refs: ${errorMessage(error)}`);
  }
  return map;
}

function isInspectors(event: Event) {
  return event
    .composedPath()
    .some((node) => node instanceof Element && node.matches(inspectorHost));
}

/** An element's parent, across the shadow roots of the page's own elements. */
function parentOf(element: Element): Element | null {
  if (element.parentElement) return element.parentElement;
  const root = element.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

/**
 * One element highlighted with the page's highlight style. A highlight the
 * Inspector already shows there, such as a pinned one, is left as it is.
 */
class OwnHighlight {
  private element: Element | undefined;

  set(element: Element | undefined) {
    if (element === this.element) return;
    this.element?.removeAttribute("data-ayme-highlight");
    this.element =
      element && !element.hasAttribute("data-ayme-highlight")
        ? element
        : undefined;
    this.element?.setAttribute("data-ayme-highlight", "");
  }
}
