import { startAyme } from "./startAyme";
import { startListApp } from "./listApp";

// The list app whose runtime session mounts the Inspector through its
// `inspector` option. The tests stop and restart Ayme through `window`.
let stop: (() => void) | undefined = startListApp({ mount: "session" });
Object.assign(window, {
  stopAyme() {
    stop?.();
    stop = undefined;
  },
  startAyme() {
    stop ??= startAyme({ mount: "session" });
  },
});
