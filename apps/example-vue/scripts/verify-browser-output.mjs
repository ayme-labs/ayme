import fs from "node:fs";
import path from "node:path";

import { decisionEndpointPath } from "../vite/decisionEndpointPath.ts";
import { appRoot, readDecisionProvider } from "./appEnvironment.ts";

const openRouterKeyPrefix = "sk-or-v1-";

function verifyBrowserOutput(directory, mode) {
  const serverOnlyMarkers = [
    "@playwright/test",
    "playwright.config",
    "tests/upstream/",
    ".spec.ts",
    ".test.ts",
    decisionEndpointPath,
    openRouterKeyPrefix,
    readDecisionProvider(mode)?.apiKey,
  ].filter(Boolean);
  const files = fs
    .readdirSync(path.join(directory, "assets"))
    .filter((file) => file.endsWith(".js"));
  if (files.length === 0)
    throw new Error(`No browser output found in ${directory}`);

  const hits = [];
  for (const file of files) {
    const contents = fs.readFileSync(
      path.join(directory, "assets", file),
      "utf8"
    );
    for (const marker of serverOnlyMarkers) {
      if (contents.includes(marker)) hits.push(`${file}: ${marker}`);
    }
  }
  if (hits.length > 0)
    throw new Error(
      `Server-only Playwright code leaked into browser output:\n${hits.join("\n")}`
    );
}

// Publication is decided at runtime setup (ADR-0030), so one build covers
// publication on and off.
verifyBrowserOutput(path.join(appRoot, "dist"), "production");
