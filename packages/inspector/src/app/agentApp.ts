import type { App } from "@modelcontextprotocol/ext-apps/app-with-deps";

import type { FullscreenState, WindowFullscreen } from "../panel";

/** The height the Inspector asks an agent app for, shown inline. */
export const INLINE_HEIGHT = 600;

/**
 * Talks to the agent app that shows this window in its chat, as an MCP App
 * (through the ext-apps SDK, over the frame's `postMessage`): it asks for
 * {@link INLINE_HEIGHT}, and gives the fullscreen the agent app offers,
 * which is none until the agent app answers. It sends no size after that,
 * so a fullscreen frame's size never reads as a request. `AppClass` is the
 * SDK's `App`: only the external build imports the SDK, so the Inspector in
 * the page carries none of it.
 */
export function connectAgentApp(AppClass: typeof App): WindowFullscreen {
  const app = new AppClass(
    { name: "ayme-inspector", version: "1" },
    { availableDisplayModes: ["inline", "fullscreen"] },
    { autoResize: false }
  );
  const listeners = new Set<() => void>();
  let state: FullscreenState = { offered: false, active: false };
  const read = () => {
    const context = app.getHostContext();
    const offered = context?.availableDisplayModes?.includes("fullscreen");
    const active = context?.displayMode === "fullscreen";
    if (offered === state.offered && active === state.active) return;
    state = { offered: offered === true, active };
    for (const listener of [...listeners]) listener();
  };
  app.onhostcontextchanged = read;
  app.onteardown = async () => ({});
  void app.connect().then(
    () => {
      read();
      void app.sendSizeChanged({ height: INLINE_HEIGHT });
    },
    // Not shown by an agent app after all: it offers nothing.
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
        .then(read, () => {});
    },
  };
}
