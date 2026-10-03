// Prints which classes the build integration treats as Page Object Models.
import path from "node:path";
import { derivePomManifests } from "../../../../../packages/unplugin-ayme/dist/index.mjs";

for (const fixture of [
  "aliasedPom",
  "namespacedPom",
  "combinedPom",
  "shadowedPom",
]) {
  const file = path.resolve(import.meta.dirname, `${fixture}.ts`);
  try {
    const manifests = derivePomManifests(file);
    const found = manifests.map(
      (m) => `${m.className} [${m.tools.map((t) => t.toolName).join(", ")}]`
    );
    console.log(
      `${fixture}: ${found.length ? found.join("; ") : "no Page Object Model"}`
    );
  } catch (error) {
    console.log(`${fixture}: build error: ${error.message}`);
  }
}
