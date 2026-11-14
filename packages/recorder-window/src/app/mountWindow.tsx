import css from "virtual:ayme-recorder-window-css";
import { createRoot } from "react-dom/client";

import type { RecorderChannel } from "../channel";
import { RecorderWindow } from "./RecorderWindow";

/** The address of the window's channel: on the server that serves the
 * window, at /channel. */
export const channelUrl = (location: Pick<Location, "host">) =>
  `ws://${location.host}/channel`;

/**
 * Mounts the window into `root` with its stylesheet, in the person's light
 * or dark scheme, showing what `channel` tells. Returns what takes it out
 * again.
 */
export function mountWindow(root: HTMLElement, channel: RecorderChannel) {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.append(style);
  if (matchMedia("(prefers-color-scheme: dark)").matches)
    document.documentElement.classList.add("dark");
  const react = createRoot(root);
  react.render(<RecorderWindow channel={channel} />);
  return () => {
    react.unmount();
    style.remove();
  };
}
