/** Whether fullscreen is offered to the Inspector's window, and whether it is fullscreen. */
export type FullscreenState = { offered: boolean; active: boolean };

/**
 * Fullscreen as an agent app that shows the Inspector's window in its chat
 * offers it: the window's header shows a fullscreen control while it is
 * offered.
 */
export type WindowFullscreen = {
  /** Calls `onChange` when the state changes; returns what stops it. */
  subscribe(onChange: () => void): () => void;
  /** The state, the same object until it changes. */
  current(): FullscreenState;
  /** Asks for fullscreen, or back to inline when the window is fullscreen. */
  toggle(): void;
};
