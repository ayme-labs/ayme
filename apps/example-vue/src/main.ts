import { createApp } from "vue";
import { initializeWebMCPPolyfill } from "@mcp-b/webmcp-polyfill";
import App from "./App.vue";
import "./style.css";

initializeWebMCPPolyfill();

export function startExampleApp() {
  window.__AYME_VUE_ACTIONS__ = [];
  return createApp(App).mount("#app");
}

startExampleApp();
