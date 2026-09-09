import { createApp } from "vue";
import App from "./App.vue";
import "./style.css";

export function startExampleApp() {
  window.__AYME_VUE_ACTIONS__ = [];
  return createApp(App).mount("#app");
}

startExampleApp();
