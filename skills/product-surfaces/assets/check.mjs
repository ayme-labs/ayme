// product-surfaces contract: 1
// Copied from the product-surfaces skill, which updates it. Edit surfaces.ts, not this file.
//
// Checks the list in surfaces.ts, beside this file:
//   node ayme/product-surfaces/check.mjs          report every problem, exit 1 when there is one
//   node ayme/product-surfaces/check.mjs --json   also print the list as JSON
//
// A source passes when git tracks it, as a file or a folder, at that path from the repository
// root. URLs are listed as not checked.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const listFile = path.join(here, "surfaces.ts");

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

let list;
try {
  list = await import(pathToFileURL(listFile).href);
} catch (error) {
  fail(
    error?.code === "ERR_UNKNOWN_FILE_EXTENSION"
      ? `This Node (${process.version}) cannot load TypeScript files. Run the check with Node 22.18 or newer.`
      : `Could not load ${listFile}:\n${error?.stack ?? error}`
  );
}

let root;
try {
  root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: here,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
} catch {
  fail(`${here} is not inside a git repository, so no source can be checked.`);
}

const isRecord = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value) => typeof value === "string" && value.trim() !== "";
const isUrl = (source) => /^[a-z][a-z0-9+.-]*:\/\//i.test(source);
// Exit status 1 is git's answer for a path it does not track; anything else is a git failure.
function isTracked(source) {
  try {
    execFileSync(
      "git",
      ["ls-files", "--error-unmatch", "--", `:(literal)${source}`],
      { cwd: root, stdio: "ignore" }
    );
    return true;
  } catch (error) {
    if (error.status === 1) return false;
    throw error;
  }
}

const problems = [];
const unchecked = [];

function checkText(where, entry, fields) {
  for (const field of fields)
    if (!isText(entry[field])) problems.push(`${where}: ${field} is missing`);
}

function checkSources(where, sources) {
  if (!Array.isArray(sources) || sources.length === 0) {
    problems.push(`${where}: sources is empty`);
    return;
  }
  for (const source of sources) {
    if (!isText(source)) {
      problems.push(`${where}: a source is not a path or a URL`);
    } else if (isUrl(source)) {
      unchecked.push(`${where}: ${source}`);
    } else if (
      path.isAbsolute(source) ||
      path.normalize(source).split(path.sep).includes("..")
    ) {
      problems.push(
        `${where}: source ${source} must be a path from the repository root`
      );
    } else if (!isTracked(source)) {
      problems.push(`${where}: source ${source} is not tracked by git`);
    }
  }
}

const consumers = isRecord(list.consumers) ? list.consumers : {};
const surfaces = isRecord(list.surfaces) ? list.surfaces : {};
if (!isRecord(list.consumers))
  problems.push("surfaces.ts does not export `consumers`");
if (!isRecord(list.surfaces))
  problems.push("surfaces.ts does not export `surfaces`");

const met = new Set();

for (const [id, consumer] of Object.entries(consumers)) {
  const where = `consumers.${id}`;
  if (!isRecord(consumer)) {
    problems.push(`${where}: is not an object`);
    continue;
  }
  checkText(where, consumer, ["name", "who", "goal"]);
  checkSources(where, consumer.sources);
}

for (const [id, surface] of Object.entries(surfaces)) {
  const where = `surfaces.${id}`;
  if (!isRecord(surface)) {
    problems.push(`${where}: is not an object`);
    continue;
  }
  checkText(where, surface, ["name", "what"]);
  const meeting = isRecord(surface.consumers)
    ? Object.entries(surface.consumers)
    : [];
  if (meeting.length === 0) problems.push(`${where}: names no consumer`);
  for (const [consumerId, does] of meeting) {
    if (!Object.hasOwn(consumers, consumerId))
      problems.push(`${where}: consumer ${consumerId} is not in \`consumers\``);
    else met.add(consumerId);
    if (!isText(does))
      problems.push(
        `${where}: consumers.${consumerId} does not say what they do there`
      );
  }
  checkSources(where, surface.sources);
}

for (const id of Object.keys(consumers))
  if (!met.has(id)) problems.push(`consumers.${id}: meets no surface`);

if (process.argv.includes("--json"))
  console.log(JSON.stringify({ consumers, surfaces }, null, 2));

if (unchecked.length > 0)
  console.error(
    `Not checked, outside the repository:\n  ${unchecked.join("\n  ")}`
  );

if (problems.length > 0)
  fail(
    `${problems.length} problem(s) in ${path.relative(root, listFile)}:\n  ${problems.join("\n  ")}`
  );

console.error(
  `${Object.keys(consumers).length} consumer(s) and ${Object.keys(surfaces).length} surface(s): every source in the repository is tracked.`
);
