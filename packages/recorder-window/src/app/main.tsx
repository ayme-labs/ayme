import css from "virtual:ayme-recorder-window-css";
import { createRoot } from "react-dom/client";

import { openRecorderChannel } from "../channel";
import { RecorderWindow } from "./RecorderWindow";

// The window's script, which the engine serves beside index.html. The
// channel is on the same server, at /channel: a reloaded window opens it
// again and is told the full state.

const style = document.createElement("style");
style.textContent = css;
document.head.append(style);
if (matchMedia("(prefers-color-scheme: dark)").matches)
  document.documentElement.classList.add("dark");

const channel = openRecorderChannel(`ws://${location.host}/channel`);
createRoot(document.getElementById("root")!).render(
  <RecorderWindow channel={channel} />
);
