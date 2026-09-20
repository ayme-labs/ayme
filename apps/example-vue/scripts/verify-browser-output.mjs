import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build, loadEnv } from "vite";

import { decisionEndpointPath } from "../vite/decisionEndpointPath.ts";

const openRouterKeyPrefix = "sk-or-v1-";
const appRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

function verifyBrowserOutput(directory, mode) {
  const serverOnlyMarkers = [
    "@playwright/test",
    "playwright.config",
    "tests/upstream/",
    ".spec.ts",
    ".test.ts",
    decisionEndpointPath,
    openRouterKeyPrefix,
    loadEnv(mode, appRoot, "").AYME_OPENROUTER_API_KEY,
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

verifyBrowserOutput(path.join(appRoot, "dist"), "production");

const disabledOutput = fs.mkdtempSync(
  path.join(os.tmpdir(), "ayme-publication-disabled-")
);
try {
  await build({
    configFile: path.join(appRoot, "vite.config.ts"),
    mode: "publication-disabled",
    build: { outDir: disabledOutput, emptyOutDir: true },
    logLevel: "warn",
  });
  verifyBrowserOutput(disabledOutput, "publication-disabled");
} finally {
  fs.rmSync(disabledOutput, { recursive: true, force: true });
}
