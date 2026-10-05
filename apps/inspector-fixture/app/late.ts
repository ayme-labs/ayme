import { startListApp } from "./listApp";

// The list app with the Inspector mounted in demo mode after the runtime
// started, so its Page Object was built before the Inspector's
// instrumentation existed.
startListApp({ mount: "after", demo: true });
