import { useSyncExternalStore } from "react";

import type { Viewport } from "./geometry";

let snapshot: Viewport | undefined;

function readViewport() {
  const { innerWidth: width, innerHeight: height } = window;
  if (snapshot?.width !== width || snapshot.height !== height)
    snapshot = { width, height };
  return snapshot;
}

function subscribe(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

/** The viewport's size, kept current as the window resizes. */
export function useViewport(): Viewport {
  return useSyncExternalStore(subscribe, readViewport);
}

export function currentViewport(): Viewport {
  return readViewport();
}
