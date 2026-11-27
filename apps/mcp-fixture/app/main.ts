import { createAyme } from "@ayme-dev/ayme";

import { Basket } from "#pom/Basket";
import { GroceriesPage } from "#pom/GroceriesPage";

/**
 * The page's own runtime, for the tests of a Session on an app that ships
 * ayme: it registers `GroceriesPage`, and publishes through WebMCP with
 * `?webmcp`. The Basket Page Object is registered only while shown, and its
 * `clear` action is available only once the basket is filled. The page
 * reports its state on <html> for the e2e tests.
 */
const root = document.documentElement.dataset;
try {
  const runtime = createAyme({
    webMCP: { enabled: new URLSearchParams(location.search).has("webmcp") },
  });
  runtime.start();
  runtime.pom.register(GroceriesPage);
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
