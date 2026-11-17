import type { App } from "@modelcontextprotocol/ext-apps/app-with-deps";

import type { FullscreenState, WindowFullscreen } from "../panel";

/** The height the Inspector asks an Agent App for, shown inline. */
export const INLINE_HEIGHT = 600;

/**
 * Talks to the Agent App that shows this window in its chat, as an MCP App
 * (through the ext-apps SDK, over the frame's `postMessage`): it asks for
 * {@link INLINE_HEIGHT}, and gives the fullscreen the Agent App offers,
 * which is none until the Agent App answers. It sends no size after that,
 * so a fullscreen frame's size never reads as a request. The document
 * itself is that tall too: the Inspector fills its window and gives the
 * document no height of its own, and an Agent App may size the frame by the
 * document's height, as Cursor does. `AppClass` is the
 * SDK's `App`: only the external build imports the SDK, so the Inspector in
 * the page carries none of it.
 */
export function connectAgentApp(AppClass: typeof App): WindowFullscreen {
  const app = new AppClass(
    { name: "ayme-inspector", version: "1" },
    { availableDisplayModes: ["inline", "fullscreen"] },
    { autoResize: false }
  );
  document.body.style.minHeight = `${INLINE_HEIGHT}px`;
  const listeners = new Set<() => void>();
  let state: FullscreenState = { offered: false, active: false };
  // The Agent App names the display mode in its answer to a request, in a
  // context change, or in both: the last one it named is the window's.
  const update = (
    displayMode: string | undefined,
    modes = app.getHostContext()?.availableDisplayModes
  ) => {
    const offered = modes?.includes("fullscreen") === true;
    const active =
      displayMode === undefined ? state.active : displayMode === "fullscreen";
    if (offered === state.offered && active === state.active) return;
    state = { offered, active };
    for (const listener of [...listeners]) listener();
  };
  app.onhostcontextchanged = ({ displayMode, availableDisplayModes }) =>
    update(displayMode, availableDisplayModes);
  app.onteardown = async () => ({});
  void app.connect().then(
    () => {
      update(app.getHostContext()?.displayMode);
      void app.sendSizeChanged({ height: INLINE_HEIGHT });
    },
    // Not shown by an Agent App after all: it offers nothing.
    () => {}
  );
  return {
    subscribe(onChange) {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    current: () => state,
    toggle() {
      void app
        .requestDisplayMode({ mode: state.active ? "inline" : "fullscreen" })
        .then(
          ({ mode }) => update(mode),
          () => {}
        );
    },
  };
}
