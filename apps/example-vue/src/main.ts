import { createApp } from "vue";
import { initializeWebMCPPolyfill } from "@mcp-b/webmcp-polyfill";
import App from "./App.vue";
import CounterRoute from "./counter/CounterRoute.vue";
import OtherRoute from "./counter/OtherRoute.vue";
import "./style.css";

initializeWebMCPPolyfill();

// The playground is the app at its base path. `counter` and `other` are the
// pages of the shared framework certification, which browse as full page
// loads; the app has no router.
const routes: Record<string, typeof App> = {
  counter: CounterRoute,
  other: OtherRoute,
};

export function startExampleApp() {
  window.__AYME_VUE_ACTIONS__ = [];
  const route = location.pathname.slice(import.meta.env.BASE_URL.length);
  return createApp(routes[route] ?? App).mount("#app");
}

startExampleApp();
