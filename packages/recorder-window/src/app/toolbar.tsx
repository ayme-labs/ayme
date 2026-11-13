import type {
  ToolbarBinding,
  ToolbarMessage,
} from "@ayme-dev/recorder/contract";
import css from "virtual:ayme-recorder-toolbar-css";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import { openPageRecorderChannel } from "../channel";
import { RecorderToolbar } from "./RecorderToolbar";

// The toolbar's script. The engine runs it in every recorded document
// before the page's own scripts, as Playwright runs a script for new
// documents, and in a document that was open before the recorder came. It
// shows in the top document only.
//
// It is no part of the recorded page: its host hides from the page's
// structure and holds a closed shadow root, and every input given to it
// stops at the window, before the page, the recorder's gate and
// Playwright's recorder hear of it.

/** The host's tag. The engine's gate leaves an input on it alone. */
const HOST = "ayme-recorder-toolbar";
/** The page function the engine puts beside this script. */
const BINDING: ToolbarBinding = "__aymeRecorderToolbar";
/** Where the page objects find the closed root: see the testing entry. */
const SHADOW_ROOT_KEY = "@ayme-dev/recorder-window/toolbar-root";
/** The event on the host that takes the toolbar out of the page, as the
 * engine sends it when it lets go of a browser that stays open. */
const REMOVE = "ayme-recorder-toolbar:remove";
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

function mount() {
  if (window !== window.top || document.querySelector(HOST)) return;
  const call = (window as unknown as Record<string, unknown>)[BINDING] as
    ((message: ToolbarMessage) => Promise<unknown>) | undefined;
  if (typeof call !== "function") return;

  const host = document.createElement(HOST);
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

  // A person's input on the toolbar goes no further than the window. A
  // click is then given to the button under it, as the toolbar's own,
  // untrusted, click: the page's listeners and Playwright's recorder do
  // not take an untrusted click for a person's.
  const stop = (event: Event) => {
    if (!event.isTrusted || !event.composedPath().includes(host)) return;
    event.stopImmediatePropagation();
    // The page keeps its focus.
    if (event.type === "mousedown") event.preventDefault();
    if (event.type !== "click") return;
    const { clientX, clientY } = event as MouseEvent;
    const button = root.elementFromPoint(clientX, clientY)?.closest("button");
    if (button && !button.disabled) button.click();
  };
  for (const type of INPUT_TYPES) window.addEventListener(type, stop, true);

  // A page that rewrites its document gets the toolbar back.
  const keep = new MutationObserver(() => {
    if (!host.isConnected && document.documentElement) {
      document.documentElement.append(host);
      keep.observe(document.documentElement, { childList: true });
    }
  });
  keep.observe(document, { childList: true });
  if (document.documentElement) {
    document.documentElement.append(host);
    keep.observe(document.documentElement, { childList: true });
  }

  const react = createRoot(container);
  // In place before the page first paints.
  flushSync(() =>
    react.render(<RecorderToolbar channel={openPageRecorderChannel(call)} />)
  );

  host.addEventListener(REMOVE, () => {
    keep.disconnect();
    for (const type of INPUT_TYPES)
      window.removeEventListener(type, stop, true);
    react.unmount();
    host.remove();
  });
}

mount();
