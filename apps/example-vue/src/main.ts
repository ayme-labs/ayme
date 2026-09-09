import { createApp } from "vue";
import App from "./App.vue";
import "./style.css";

export function startExampleApp() {
  const modelContext = (document as Document & { modelContext?: unknown })
    .modelContext;
  if (!modelContext) {
    throw new Error(
      "The WebMCP polyfill must initialize before the example app starts."
    );
  }

  window.__AYME_VUE_ACTIONS__ = [];
  return createApp(App).mount("#app");
}

startExampleApp();
