import fs from "node:fs";
import path from "node:path";

import { decisionEndpointPath } from "../vite/decisionEndpointPath.ts";
import { appRoot, readModelKeys } from "./appEnvironment.ts";

const openRouterKeyPrefix = "sk-or-v1-";

// The code view (src/demo/PageObjectCode.vue) shows these Page Objects as
// text, so their source appears in the output verbatim, naming Playwright.
// Only what is outside it counts: a Page Object that leaked as code would be
// compiled, not verbatim.
const shownSources = [
  "ListPage.ts",
  "ListItem.ts",
  "ArchiveDialog.ts",
  "AppComponent.ts",
  "AppPage.ts",
].map((file) =>
  fs.readFileSync(path.join(appRoot, "playwright/pom", file), "utf8")
);

// What a Build without Ayme leaves out: the runtime's own text, the compiled
// Page Object Model manifest, the models' action descriptions and locator
// calls, Playwright in the browser and the Inspector. The labels the models
// look up are the demo's own UI text too, so the locator calls that carry
// them stand for them.
const aymeMarkers = [
  "Waiting for the WebMCP driver.",
  "memberName",
  "Set counter mode metadata.",
  "getByRole",
  "playwright-lite",
  "ayme-inspector",
];

/** Every `file: marker` pair where a browser chunk in `directory` carries a marker. */
function findMarkers(directory, markers) {
  const files = fs
    .readdirSync(path.join(directory, "assets"))
    .filter((file) => file.endsWith(".js"));
  if (files.length === 0)
    throw new Error(`No browser output found in ${directory}`);

  const hits = [];
  for (const file of files) {
    const contents = shownSources.reduce(
      (rest, source) => rest.replaceAll(source, ""),
      fs.readFileSync(path.join(directory, "assets", file), "utf8")
    );
    for (const marker of markers) {
      if (contents.includes(marker)) hits.push(`${file}: ${marker}`);
    }
  }
  return hits;
}

function verifyBrowserOutput(directory, mode) {
  const serverOnlyMarkers = [
    "@playwright/test",
    "playwright.config",
    "tests/upstream/",
    ".spec.ts",
    ".test.ts",
    decisionEndpointPath,
    openRouterKeyPrefix,
    ...readModelKeys(mode).map(({ apiKey }) => apiKey),
  ].filter(Boolean);
  const hits = findMarkers(directory, serverOnlyMarkers);
  if (hits.length > 0)
    throw new Error(
      `Server-only Playwright code leaked into browser output:\n${hits.join("\n")}`
    );
}

function verifyBuildWithoutAyme(directory) {
  const hits = findMarkers(directory, aymeMarkers);
  if (hits.length > 0)
    throw new Error(`Ayme is in the build without Ayme:\n${hits.join("\n")}`);
}

// Publication is decided at runtime setup (ADR-0030), so one build covers
// publication on and off.
verifyBrowserOutput(path.join(appRoot, "dist"), "production");
// The build without Ayme (`vite build --mode without-ayme`) proves on a real
// consumer what the build plugin promises for `include: false`, and leaks
// no server-only code either.
verifyBrowserOutput(path.join(appRoot, "dist-without-ayme"), "without-ayme");
verifyBuildWithoutAyme(path.join(appRoot, "dist-without-ayme"));
