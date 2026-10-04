import type { StructureNode } from "../../structure/domain/structure";

/** The Inspector's own host element on the page. */
const inspectorHost = "[data-ayme-inspector-host]";

/**
 * Which nodes of the structure a tool can use: the refs the tool can take
 * in the page state, as the runtime offers them to the Goal Loop. A tool
 * the runtime lists no targets for, such as one that isn't a single-element tool, can
 * use every node: then it's undefined.
 *
 * @param elementToolTargets the refs each published single-element tool can take, by name.
 */
export function refFilterOf(
  elementToolTargets: ReadonlyMap<string, readonly string[]>,
  toolName: string
): ((node: StructureNode & { ref: string }) => boolean) | undefined {
  const targets = elementToolTargets.get(toolName);
  if (!targets) return undefined;
  const usable = new Set(targets);
  return (node) => usable.has(node.ref);
}

/**
 * What picking with a tool asks the person to click, e.g. "Click a text
 * field to fill".
 */
export function pickPromptOf(toolName: string): string {
  switch (toolName) {
    case "click":
      return "Click an element to click";
    case "hover":
      return "Click an element to hover";
    case "type":
      return "Click a text field to type into";
    case "fill":
      return "Click a text field to fill";
    case "check":
      return "Click a checkbox to check";
    case "uncheck":
      return "Click a checkbox to uncheck";
    case "select_option":
      return "Click a select to choose from";
    default:
      return `Click an element for ${toolName}`;
  }
}

/** How picking a ref on the page ends: with the ref picked, or none. */
export type RefPickingHandlers = {
  /** Whether a ref can be picked. The element of one that can't shows greyed. */
  accept: (ref: string) => boolean;
  /** Called once: with the ref clicked, or with none when Esc cancels. */
  onEnd: (ref: string | undefined) => void;
};

/** What picking reads from the page and shows on it. */
export type RefPickingPage = {
  /** An element's ref in the latest look at the page, if it has one. */
  refOf: (element: Element) => string | undefined;
  /** Highlights a ref's element, or none. */
  hover: (ref: string | undefined) => void;
};

/**
 * Picks a ref by pointing at the page. The element under the pointer that
 * carries a ref is highlighted, or greyed when it can't be picked; a click
 * picks it and Esc cancels. The pointer is a crosshair over the page, and
 * the page doesn't act on those presses. The Inspector's own elements are
 * left alone.
 *
 * @returns stops picking without calling `onEnd`.
 */
export function startRefPicking({
  accept,
  onEnd,
  refOf,
  hover,
}: RefPickingHandlers & RefPickingPage): () => void {
  const greyed = new Mark(unusableAttribute);
  const releaseStyle = holdPickingStyle();
  let hovered: string | undefined;
  let stopped = false;

  /** The element with a ref at an event's target, and whether it can be picked. */
  const pointedAt = (target: EventTarget | undefined) => {
    for (
      let element = target as Element | null | undefined;
      element instanceof Element;
      element = parentOf(element)
    ) {
      const ref = refOf(element);
      if (ref !== undefined) return { element, ref, usable: accept(ref) };
    }
  };
  const show = (pointed: ReturnType<typeof pointedAt>) => {
    const ref = pointed?.usable ? pointed.ref : undefined;
    if (ref !== hovered) hover((hovered = ref));
    greyed.set(pointed && !pointed.usable ? pointed.element : undefined);
  };

  const onMove = (event: PointerEvent) =>
    show(isInspectors(event) ? undefined : pointedAt(event.composedPath()[0]));
  // Presses on the page pick; the page itself never sees them.
  const block = (event: Event) => {
    if (isInspectors(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const onClick = (event: MouseEvent) => {
    if (isInspectors(event)) return;
    block(event);
    const picked = pointedAt(event.composedPath()[0]);
    if (picked?.usable) end(picked.ref);
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    end(undefined);
  };

  // Every press but the click, which picks: a double click on an element the
  // tool can't use, or a right or middle press, never reaches the page either.
  const blocked = [
    "pointerdown",
    "mousedown",
    "pointerup",
    "mouseup",
    "dblclick",
    "auxclick",
    "contextmenu",
  ];
  const stop = () => {
    if (stopped) return;
    stopped = true;
    window.removeEventListener("pointermove", onMove, true);
    window.removeEventListener("click", onClick, true);
    window.removeEventListener("keydown", onKey, true);
    for (const type of blocked) window.removeEventListener(type, block, true);
    show(undefined);
    releaseStyle();
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

const unusableAttribute = "data-ayme-pick-unusable";

/**
 * While any picking is on: the pointer is a crosshair over the page, and an
 * element that can't be picked has a grey outline.
 */
const pickingStyleText = `
html, html * { cursor: crosshair !important; }
[data-ayme-inspector-host] { cursor: auto !important; }
[${unusableAttribute}] { outline: 2px dashed #9ca3af !important; outline-offset: 3px; }
`;

const pickingStyle = {
  holders: 0,
  element: undefined as HTMLStyleElement | undefined,
};

/**
 * Holds the picking style in the host document. It's there while anything
 * holds it and removed when the last holder releases it.
 *
 * @returns releases it; releasing more than once does nothing.
 */
function holdPickingStyle(): () => void {
  if (pickingStyle.holders++ === 0) {
    const element = document.createElement("style");
    element.dataset.aymeInspectorPicking = "";
    element.textContent = pickingStyleText;
    document.head.append(element);
    pickingStyle.element = element;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--pickingStyle.holders > 0) return;
    pickingStyle.element?.remove();
    pickingStyle.element = undefined;
  };
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

/** One element marked with an attribute, for the picking style to draw. */
class Mark {
  private element: Element | undefined;

  constructor(private readonly attribute: string) {}

  set(element: Element | undefined) {
    if (element === this.element) return;
    this.element?.removeAttribute(this.attribute);
    this.element = element;
    this.element?.setAttribute(this.attribute, "");
  }
}
