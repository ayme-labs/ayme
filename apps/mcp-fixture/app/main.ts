import { createAyme, type CustomTool } from "@ayme-dev/ayme";

import { Basket } from "./Basket";

/** A Custom Tool: it returns the text of the element it's given. */
const readText: CustomTool = {
  name: "read_text",
  description: "Read the text of one element on the page.",
  async execute({ element }) {
    return element.textContent;
  },
};

/**
 * Starts the runtime with the Agent Connection on. WebMCP publication is off
 * unless the URL has `?webmcp`, so the page shows the connection does not
 * need it. The Basket Page Object is registered only while shown. The page
 * reports its state on <html> for the e2e tests.
 */
const root = document.documentElement.dataset;
try {
  const runtime = createAyme({
    customTools: [readText],
    agentConnection: true,
    webMCP: { enabled: new URLSearchParams(location.search).has("webmcp") },
  });
  runtime.start();
  // The Basket Page Object comes and goes with these buttons, as a
  // component's Page Object does when it mounts and unmounts.
  document
    .querySelector("#show-basket")!
    .addEventListener("click", () => runtime.pom.register(Basket));
  document
    .querySelector("#hide-basket")!
    .addEventListener("click", () => runtime.pom.unregister(Basket));
  root.fixture = "ready";
} catch (error) {
  root.fixture = "failed";
  root.fixtureError = error instanceof Error ? error.message : String(error);
  throw error;
}
