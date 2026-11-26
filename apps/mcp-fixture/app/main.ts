import { createAyme, type CustomTool } from "@ayme-dev/ayme";

import { Basket } from "#pom/Basket";
import { GroceriesPage } from "#pom/GroceriesPage";
import { OtherPage } from "#pom/OtherPage";

/**
 * A Custom Tool: it returns the text of the element it's given. `ayme mcp`
 * lists the page's Page Objects, not its Custom Tools: this shows it does not.
 */
const readText: CustomTool = {
  name: "read_text",
  description: "Read the text of one element on the page.",
  async execute({ locator }) {
    return locator.textContent();
  },
};

/**
 * Starts the runtime with the Agent Connection on, and registers the page's
 * own Page Object, `OtherPage` on `/other` and `GroceriesPage` elsewhere.
 * WebMCP publication is off unless the URL has `?webmcp`, so the page shows
 * the connection does not need it. `?inspector` mounts the Inspector. The
 * Basket Page Object is registered only while shown, and its `clear` action
 * is available only once the basket is filled. The page reports its state on
 * <html> for the e2e tests.
 */
const root = document.documentElement.dataset;
try {
  const runtime = createAyme({
    customTools: [readText],
    agentConnection: true,
    webMCP: { enabled: new URLSearchParams(location.search).has("webmcp") },
    inspector: new URLSearchParams(location.search).has("inspector"),
  });
  runtime.start();
  if (location.pathname === "/other") runtime.pom.register(OtherPage);
  else runtime.pom.register(GroceriesPage);
  // `?peek=<name>` adds a Peek of that name, which reads "page".
  const peekName = new URLSearchParams(location.search).get("peek");
  if (peekName) runtime.peek(() => ({ value: "page" }), peekName);
  // The Basket Page Object comes and goes with these buttons, as a
  // component's Page Object does when it mounts and unmounts.
  document
    .querySelector("#show-basket")!
    .addEventListener("click", () => runtime.pom.register(Basket));
  document
    .querySelector("#hide-basket")!
    .addEventListener("click", () => runtime.pom.unregister(Basket));
  // Filling the basket makes its `clear` action available.
  document.querySelector("#fill-basket")!.addEventListener("click", () => {
    const item = document.createElement("li");
    item.textContent = "Milk";
    document.querySelector("#basket-items")!.append(item);
  });
  root.fixture = "ready";
} catch (error) {
  root.fixture = "failed";
  root.fixtureError = error instanceof Error ? error.message : String(error);
  throw error;
}
