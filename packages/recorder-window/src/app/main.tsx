import { openRecorderChannel } from "../channel";
import { channelUrl, mountWindow } from "./mountWindow";

// The window's script, which the engine serves beside index.html: it only
// mounts the window. The channel is on the same server: a reloaded window
// opens it again and is told the full state.

mountWindow(
  document.getElementById("root")!,
  openRecorderChannel(channelUrl(location))
);
