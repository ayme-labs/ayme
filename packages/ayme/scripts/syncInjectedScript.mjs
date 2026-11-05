// Copies the pinned Playwright InjectedScript artifact from the Playwright
// Lite tag package.json pins into build/generated, where the in-page
// module's build reads it (build/pinnedAriaSnapshot.ts). Run it after
// moving the pin, then review the artifact and update the size and hash
// the build checks.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
);
const pin = /#([a-f0-9]{40})$/.exec(
  packageJson.devDependencies["@ayme-dev/playwright-lite"]
)?.[1];
if (!pin) throw new Error("@ayme-dev/playwright-lite is not pinned to a SHA.");
const response = await fetch(
  `https://raw.githubusercontent.com/ayme-labs/playwright-lite/${pin}/build/generated/injectedScriptSource.ts`
);
if (!response.ok) throw new Error(`Fetching the artifact: ${response.status}`);
const artifact = Buffer.from(await response.arrayBuffer());
writeFileSync(
  new URL("../build/generated/injectedScriptSource.ts", import.meta.url),
  artifact
);
console.log(
  `InjectedScript: ${artifact.byteLength} bytes, sha256 ${createHash("sha256").update(artifact).digest("hex")}`
);
