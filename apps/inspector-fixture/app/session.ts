import { startAyme } from "./startAyme";
import { startListApp } from "./listApp";

// The list app whose runtime session mounts the Inspector through its
// `inspector` option, in demo mode with `?demo`. The tests stop and restart
// Ayme through `window`.
const demo = new URLSearchParams(location.search).has("demo");
let stop: (() => void) | undefined = startListApp({ mount: "session", demo });
Object.assign(window, {
  stopAyme() {
    stop?.();
    stop = undefined;
  },
  startAyme() {
    stop ??= startAyme({ mount: "session", demo });
  },
});
