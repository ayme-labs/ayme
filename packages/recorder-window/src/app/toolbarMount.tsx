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

/** The host's closed root, with the toolbar's stylesheet and the element
 * React renders into. */
function shadowRootFor(host: HTMLElement) {
  const root = host.attachShadow({ mode: "closed" });
  (host as unknown as Record<symbol, ShadowRoot>)[Symbol.for(SHADOW_ROOT_KEY)] =
    root;
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  root.adoptedStyleSheets = [sheet];
  const container = document.createElement("div");
  container.className = "fixed right-3 bottom-3 font-sans";
  if (matchMedia("(prefers-color-scheme: dark)").matches)
    container.classList.add("dark");
  root.append(container);
  return { root, container };
}

/** The button of the toolbar under a click, if any. */
const buttonAt = (root: ShadowRoot, { clientX, clientY }: MouseEvent) =>
  root.elementFromPoint(clientX, clientY)?.closest("button");

/**
 * What stops a person's input on the toolbar at the window. A click is then
 * given to the button under it, as the toolbar's own, untrusted, click: the
 * page's listeners and Playwright's recorder do not take an untrusted click
 * for a person's.
 */
export function stopperFor(host: HTMLElement, root: ShadowRoot) {
  const press = (event: MouseEvent) => {
    const button = buttonAt(root, event);
    if (button && !button.disabled) button.click();
  };
  const afterStopping: Partial<Record<string, (event: Event) => void>> = {
    // The page keeps its focus.
    mousedown: (event) => event.preventDefault(),
    click: (event) => press(event as MouseEvent),
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
  const { root, container } = shadowRootFor(host);

  // A person's input on the toolbar goes no further than the window.
  const stop = stopperFor(host, root);
  for (const type of INPUT_TYPES) window.addEventListener(type, stop, true);
  const keep = keepInDocument(host);

  const react = createRoot(container);
  // In place before the page first paints.
  flushSync(() =>
    react.render(<RecorderToolbar channel={openPageRecorderChannel(call)} />)
  );

  host.addEventListener(TOOLBAR_REMOVE, () => {
    keep.disconnect();
    for (const type of INPUT_TYPES)
      window.removeEventListener(type, stop, true);
    react.unmount();
    host.remove();
  });
  return host;
}
