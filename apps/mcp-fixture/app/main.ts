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

/** The Custom Tool `/other` offers in place of `read_text`. */
const readOther: CustomTool = {
  name: "read_other",
  description: "Read the text of one element on the other page.",
  async execute({ element }) {
    return element.textContent;
  },
};

/**
 * A Custom Tool that never answers, so a call stays in flight. The page
 * shows the ref it holds on <html> as `data-holding`.
 */
const hold: CustomTool = {
  name: "hold",
  description: "Keep the call in flight; it never answers.",
  execute({ ref }) {
    document.documentElement.dataset.holding = ref;
    return new Promise(() => {});
  },
};

/**
 * Starts the runtime with the Agent Connection on. WebMCP publication is off
 * unless the URL has `?webmcp`, so the page shows the connection does not
 * need it. `?inspector` mounts the Inspector. The Basket Page Object is registered
 * only while shown, and its `clear` action is available only once the basket
 * is filled. The page reports its state on <html> for the e2e tests.
 */
const root = document.documentElement.dataset;
try {
  const runtime = createAyme({
    customTools: [location.pathname === "/other" ? readOther : readText, hold],
    agentConnection: true,
    webMCP: { enabled: new URLSearchParams(location.search).has("webmcp") },
    inspector: new URLSearchParams(location.search).has("inspector"),
  });
  runtime.start();
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
