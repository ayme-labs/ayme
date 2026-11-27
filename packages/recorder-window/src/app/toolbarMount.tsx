import type {
  ToolbarBinding,
  ToolbarMessage,
} from "@ayme-dev/recorder/contract";
import css from "virtual:ayme-recorder-toolbar-css";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import { openPageRecorderChannel } from "../channel";
import { RecorderToolbar } from "./RecorderToolbar";

// How the toolbar is put in a recorded page and taken out again; the
// toolbar's script (toolbar.tsx) only calls it.
//
// It is no part of the recorded page: its host hides from the page's
// structure and holds a closed shadow root, and every input given to it
// stops at the window, before the page, the recorder's gate and
// Playwright's recorder hear of it.

/** The host's tag. The engine's gate leaves an input on it alone. */
export const TOOLBAR_HOST = "ayme-recorder-toolbar";
/** The page function the engine puts beside the toolbar's script. */
const BINDING: ToolbarBinding = "__aymeRecorderToolbar";
/** Where the page objects find the closed root: see the testing entry. */
const SHADOW_ROOT_KEY = "@ayme-dev/recorder-window/toolbar-root";
/** The event on the host that takes the toolbar out of the page, as the
 * engine sends it when it lets go of a browser that stays open. */
export const TOOLBAR_REMOVE = "ayme-recorder-toolbar:remove";
/** The input a person gives the toolbar. */
const INPUT_TYPES = [
  "pointerdown",
  "pointerup",
  "mousedown",
  "mouseup",
  "click",
  "auxclick",
  "dblclick",
  "contextmenu",
  "keydown",
  "keyup",
] as const;

/** The page function: the toolbar's way to the recorder. */
export type ToolbarCall = (message: ToolbarMessage) => Promise<unknown>;

/**
 * The page function the engine put beside the toolbar's script, in a top
 * document that has no toolbar yet; none in a frame, where one is shown, or
 * where the engine put none.
 */
export function bindingIn(
  view: { readonly top: unknown },
  document: Pick<Document, "querySelector">
): ToolbarCall | undefined {
  if (view !== view.top || document.querySelector(TOOLBAR_HOST))
    return undefined;
  const call = (view as Record<string, unknown>)[BINDING];
  return typeof call === "function" ? (call as ToolbarCall) : undefined;
}

/** The host: out of the page's structure and of its layout. */
function createHost() {
  const host = document.createElement(TOOLBAR_HOST);
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = [
    "all: initial",
    "position: fixed",
    "inset: 0",
    "pointer-events: none",
    "z-index: 2147483647",
    "contain: strict",
  ]
    .map((rule) => `${rule} !important`)
    .join(";");
  return host;
}

/** The host's closed root, with the toolbar's stylesheet, the element React
 * renders into, and the invoker around it (`popoversShown`). */
function shadowRootFor(host: HTMLElement) {
  const root = host.attachShadow({ mode: "closed" });
  (host as unknown as Record<symbol, ShadowRoot>)[Symbol.for(SHADOW_ROOT_KEY)] =
    root;
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  root.adoptedStyleSheets = [sheet];
  const invoker = document.createElement("button");
  invoker.tabIndex = -1;
  invoker.style.cssText = "all: unset; display: contents";
  // Chromium hands it the click the toolbar gives a button inside it: it
  // must not show or hide the page's popover.
  invoker.addEventListener("click", (event) => event.preventDefault());
  const container = document.createElement("div");
  // At the top centre of the page, as the released toolbar.
  container.className = "fixed top-3 left-1/2 -translate-x-1/2 font-sans";
  invoker.append(container);
  root.append(invoker);
  return { root, container, invoker };
}

/**
 * The page's open popovers, in the order they were shown, which the browser
 * keeps to itself. The browser closes a popover on a press outside it
 * before any listener hears of it, but not on a press inside a button that
 * targets it, nor on one inside a button that targets a popover above it:
 * so the toolbar, inside such a button, targets the topmost on each press.
 * Only the document's popovers: one in a shadow root tells nothing outside
 * it, and cannot be the toolbar's target either.
 */
function popoversShown() {
  // Popovers open before the toolbar came, as on a browser it attached to,
  // in the document's order.
  let shown = [...document.querySelectorAll<HTMLElement>(":popover-open")];
  // Any toggle, shown or hidden, of a popover or not: `topmost` keeps only
  // the popovers still open.
  const onToggle = ({ target }: Event) => {
    shown = [...shown.filter((each) => each !== target), target as HTMLElement];
  };
  window.addEventListener("toggle", onToggle, true);
  return {
    /** The topmost open popover a press outside closes, if any. */
    topmost(): HTMLElement | null {
      // A popover taken out of the page while open is closed with no toggle.
      shown = shown.filter((each) => each.matches(":popover-open"));
      return shown.findLast((each) => each.popover !== "manual") ?? null;
    },
    // Stryker disable next-line all: a listener left behind only keeps a list no press reads
    stop: () => window.removeEventListener("toggle", onToggle, true),
  };
}

const buttonAt = (root: ShadowRoot, { clientX, clientY }: MouseEvent) => {
  const element = root.elementFromPoint(clientX, clientY);
  // Stryker disable next-line OptionalChaining: a point whose input reaches the toolbar lies on one of its elements
  return element?.closest("button");
};

/**
 * What stops a person's input on the toolbar at the window. A click is then
 * given to the button under it, as the toolbar's own click, which stays in
 * the closed root: the page's listeners and Playwright's recorder hear none
 * of it, so a panel the page closes on a click elsewhere stays open.
 */
function stopperFor(
  host: HTMLElement,
  root: ShadowRoot,
  invoker: HTMLButtonElement,
  popovers: ReturnType<typeof popoversShown>
) {
  const press = (event: MouseEvent) => {
    const button = buttonAt(root, event);
    if (button && !button.disabled)
      button.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          composed: false,
        })
      );
  };
  const afterStopping: Partial<Record<string, (event: Event) => void>> = {
    // In time: the browser decides which popovers a press closes at its
    // release or its click.
    pointerdown: () => (invoker.popoverTargetElement = popovers.topmost()),
    // The page keeps its focus.
    mousedown: (event) => event.preventDefault(),
    click: (event) => {
      // The invoker shows or hides no popover of the page.
      event.preventDefault();
      press(event as MouseEvent);
    },
  };
  const onToolbar = (event: Event) =>
    event.isTrusted && event.composedPath().includes(host);
  return (event: Event) => {
    if (!onToolbar(event)) return;
    event.stopImmediatePropagation();
    afterStopping[event.type]?.(event);
  };
}

/** Keeps the host in the document: a page that rewrites its document gets
 * the toolbar back. */
function keepInDocument(host: HTMLElement) {
  const place = () => {
    if (host.isConnected || !document.documentElement) return;
    document.documentElement.append(host);
    keep.observe(document.documentElement, { childList: true });
  };
  const keep = new MutationObserver(place);
  keep.observe(document, { childList: true });
  place();
  return keep;
}

/**
 * Puts the toolbar in this page, talking to the recorder through `call`,
 * and returns its host. The event `TOOLBAR_REMOVE` on the host takes it out
 * again, with everything it listens to.
 */
export function mountToolbar(call: ToolbarCall): HTMLElement {
  const host = createHost();
  const { root, container, invoker } = shadowRootFor(host);
  const popovers = popoversShown();

  const stop = stopperFor(host, root, invoker, popovers);
  for (const type of INPUT_TYPES) window.addEventListener(type, stop, true);
  const keep = keepInDocument(host);

  const react = createRoot(container);
  // In place before the page first paints.
  flushSync(() =>
    react.render(<RecorderToolbar channel={openPageRecorderChannel(call)} />)
  );

  host.addEventListener(TOOLBAR_REMOVE, () => {
    keep.disconnect();
    popovers.stop();
    for (const type of INPUT_TYPES)
      // Stryker disable next-line CallExpression,BooleanLiteral: a listener left behind never matches a host that is gone
      window.removeEventListener(type, stop, true);
    react.unmount();
    host.remove();
  });
  return host;
}
