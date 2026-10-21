import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

const appRoot = fileURLToPath(new URL("../", import.meta.url));

// What a Build without Ayme leaves out: the runtime's own text, the compiled
// Page Object Model manifest, whose key stands for the registration call
// the build minifies, the models' action descriptions and locator calls,
// and Playwright in the browser.
const aymeMarkers = [
  "Waiting for the WebMCP driver.",
  "memberName",
  "Set counter mode metadata.",
  "getByRole",
  "playwright-lite",
];

// What the models' bodies carry and a source map must not: the locator call
// and an action's description.
const modelMarkers = ["getByRole", "Set counter mode metadata."];

/** Every file under `directory` with `extension`, at any depth. */
function filesUnder(directory, extension) {
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

/** Every `file: marker` pair where a browser chunk in `distDir` carries a marker. */
function findMarkers(distDir, markers) {
  const files = filesUnder(path.join(distDir, "static"), ".js");
  if (files.length === 0)
    throw new Error(`No browser output found in ${distDir}`);
  const hits = [];
  for (const file of files) {
    const contents = fs.readFileSync(file, "utf8");
    for (const marker of markers)
      if (contents.includes(marker))
        hits.push(`${path.relative(appRoot, file)}: ${marker}`);
  }
  return hits;
}

/** Every `file: marker` pair where a browser source map's sources carry a marker. */
function findMappedMarkers(distDir, markers) {
  const files = filesUnder(path.join(distDir, "static"), ".js.map");
  if (files.length === 0)
    throw new Error(`No browser source maps found in ${distDir}`);
  const hits = [];
  for (const file of files) {
    const map = JSON.parse(fs.readFileSync(file, "utf8"));
    const contents = (map.sourcesContent ?? []).join("\n");
    for (const marker of markers)
      if (contents.includes(marker))
        hits.push(`${path.relative(appRoot, file)}: ${marker}`);
  }
  return hits;
}

// The build with Ayme carries the markers, so a stale marker list would
// fail here rather than pass the build without Ayme by accident.
const withAyme = path.join(appRoot, ".next");
const present = new Set(
  findMarkers(withAyme, aymeMarkers).map((hit) => hit.split(": ")[1])
);
const absent = aymeMarkers.filter((marker) => !present.has(marker));
if (absent.length > 0)
  throw new Error(
    `The build with Ayme carries none of these markers, so they prove nothing:\n${absent.join("\n")}`
  );

// The build without Ayme (`AYME_INCLUDE=false next build`) proves on a real
// Next.js app what the build plugin promises for `include: false`, in the
// browser chunks and in their source maps.
const withoutAyme = path.join(appRoot, ".next-without-ayme");
const hits = findMarkers(withoutAyme, aymeMarkers);
if (hits.length > 0)
  throw new Error(`Ayme is in the build without Ayme:\n${hits.join("\n")}`);
const mapped = findMappedMarkers(withoutAyme, modelMarkers);
if (mapped.length > 0)
  throw new Error(
    `A Page Object Model is in the source maps of the build without Ayme:\n${mapped.join("\n")}`
  );
