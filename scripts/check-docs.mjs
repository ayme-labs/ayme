/**
 * Checks the consumer docs in `docs/guide/` and every README.
 *
 *   node scripts/check-docs.mjs    check the repository, print each problem
 *
 * It fails when
 * - a relative link does not resolve to a file or directory,
 * - a relative link in a page under `docs/guide/` leaves `docs/guide/`, since
 *   the docs site serves only that directory,
 * - a `github.com/ayme-labs/ayme/blob/main/...` or `tree/main/...` link does
 *   not resolve to a path in the repository,
 * - a page under `docs/guide/` is not linked from its index, `README.md`,
 * - a page under `docs/guide/` does not open with an H1 title followed by a
 *   one-sentence description paragraph,
 * - the README of a published package (one under `packages/` that is not
 *   private) contains a bare issue reference, a relative link or a banned
 *   phrase, since npm shows it without the repository around it.
 *
 * Code spans and fenced code blocks are ignored. Uses only `node:` modules.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const GUIDE_DIR = "docs/guide";
const SKIPPED_DIRS = new Set(["node_modules", "dist", "build", "build-spa"]);
const REPOSITORY_URL =
  /^https?:\/\/github\.com\/ayme-labs\/ayme\/(?:blob|tree)\/main(?:\/([^?#]*))?/;
const BANNED_PHRASES = [
  "not published yet",
  "prototype does not certify",
  "supplied tarballs",
];

/** Markdown files under `dir`, as paths relative to `root`. */
function markdownFiles(root, dir = "") {
  const files = [];
  for (const entry of fs.readdirSync(path.join(root, dir), {
    withFileTypes: true,
  })) {
    const relative = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) {
      // A directory with its own `.git` is a submodule or another repository, whose docs are not ours.
      if (
        !entry.name.startsWith(".") &&
        !SKIPPED_DIRS.has(entry.name) &&
        !fs.existsSync(path.join(root, relative, ".git"))
      )
        files.push(...markdownFiles(root, relative));
    } else if (entry.name.endsWith(".md")) files.push(relative);
  }
  return files;
}

/** READMEs of the packages npm publishes: those not marked private. */
function publishedReadmes(root) {
  const packages = path.join(root, "packages");
  if (!fs.existsSync(packages)) return new Set();
  return new Set(
    fs
      .readdirSync(packages)
      .filter((dir) => {
        const manifest = path.join(packages, dir, "package.json");
        return (
          fs.existsSync(manifest) &&
          !JSON.parse(fs.readFileSync(manifest, "utf8")).private
        );
      })
      .map((dir) => `packages/${dir}/README.md`)
  );
}

/** The text with code blocks, code spans and comments blanked, lines kept. */
function prose(text) {
  return text
    .replace(
      /^ {0,3}((`)\2{2,}|(~)\3{2,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1(?:\2|\3)*[ \t]*$|(?![\s\S]))/gm,
      (block) => block.replace(/[^\n]/g, "")
    )
    .replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, ""))
    .replace(/(`+)[^\n]*?\1/g, "code");
}

const LINK_PATTERNS = [
  // [text](target "title") and ![alt](target)
  /\]\(\s*<?([^)\s>]+)>?(?:\s+["'(][^)]*)?\)/g,
  // [label]: target
  /^ {0,3}\[[^\]]+\]:\s*<?([^\s>]+)>?/gm,
  // <a href="target"> and <img src="target">
  /\b(?:href|src)="([^"]+)"/g,
];

/** Every link target in the prose, with its 1-based line. */
function links(text) {
  const found = [];
  for (const pattern of LINK_PATTERNS)
    for (const match of text.matchAll(pattern))
      found.push({ target: match[1], line: lineOf(text, match.index) });
  return found;
}

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

function isRelative(target) {
  return !target.startsWith("#") && !/^([a-z][a-z\d+.-]*:|\/\/)/i.test(target);
}

/** The repository path a link points at, or undefined for external links. */
function linkedPath(root, file, target) {
  if (isRelative(target)) {
    const local = decodeURIComponent(target.replace(/[?#].*$/, ""));
    return local.startsWith("/")
      ? path.join(root, local)
      : path.join(root, path.dirname(file), local);
  }
  const repository = REPOSITORY_URL.exec(target);
  if (repository)
    return path.join(root, decodeURIComponent(repository[1] ?? ""));
  return undefined;
}

/** Problems with the H1 and one-sentence description a guide page opens with. */
function pageShape(lines) {
  let index = lines.findIndex((line) => line.trim() !== "");
  if (!/^# \S/.test(lines[index] ?? ""))
    return "does not open with an H1 title";
  index++;
  while (index < lines.length && lines[index].trim() === "") index++;
  const paragraph = [];
  while (index < lines.length && lines[index].trim() !== "")
    paragraph.push(lines[index++].trim());
  const description = paragraph.join(" ");
  if (!description || /^([#>|<*+-]|\d+\.\s)/.test(description))
    return "has no description paragraph after its title";
  if (!/[.!?]$/.test(description) || /[.!?]\s+\S/.test(description))
    return "description paragraph is not one sentence";
  return undefined;
}

/** Every docs problem under `root`, as `file:line: message` strings. */
export function checkDocs(root) {
  const problems = [];
  const report = (file, line, message) =>
    problems.push(`${file}:${line}: ${message}`);
  const published = publishedReadmes(root);
  const all = markdownFiles(root);
  const pages = all.filter((file) => file.startsWith(`${GUIDE_DIR}/`));
  const checked = all.filter(
    (file) => path.posix.basename(file) === "README.md" || pages.includes(file)
  );
  const indexed = new Set();

  for (const file of checked) {
    const text = prose(fs.readFileSync(path.join(root, file), "utf8"));
    const isPublished = published.has(file);
    for (const { target, line } of links(text)) {
      const linked = linkedPath(root, file, target);
      if (linked !== undefined && !fs.existsSync(linked))
        report(file, line, `link does not resolve: ${target}`);
      if (
        pages.includes(file) &&
        isRelative(target) &&
        fs.existsSync(linked) &&
        path.relative(path.join(root, GUIDE_DIR), linked).split(path.sep)[0] ===
          ".."
      )
        report(
          file,
          line,
          `link leaves ${GUIDE_DIR}, the docs site cannot serve it; use a github.com/ayme-labs/ayme/blob/main/ link: ${target}`
        );
      if (file === `${GUIDE_DIR}/README.md` && linked !== undefined)
        indexed.add(path.relative(root, linked).split(path.sep).join("/"));
      if (isPublished && isRelative(target))
        report(
          file,
          line,
          `relative link in a published README, npm cannot resolve it: ${target}`
        );
    }
    if (pages.includes(file)) {
      const problem = pageShape(text.split("\n"));
      if (problem) report(file, 1, problem);
    }
    if (isPublished) {
      for (const match of text.matchAll(/(?<![\w&/])#\d+\b/g))
        report(
          file,
          lineOf(text, match.index),
          `bare issue reference in a published README: ${match[0]}`
        );
      const lower = text.toLowerCase();
      for (const phrase of BANNED_PHRASES) {
        const at = lower.indexOf(phrase);
        if (at !== -1)
          report(
            file,
            lineOf(text, at),
            `banned phrase in a published README: "${phrase}"`
          );
      }
    }
  }

  for (const page of pages)
    if (page !== `${GUIDE_DIR}/README.md` && !indexed.has(page))
      report(page, 1, `page is not listed in ${GUIDE_DIR}/README.md`);

  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const problems = checkDocs(root);
  for (const problem of problems) console.error(problem);
  if (problems.length > 0) {
    console.error(`docs check: ${problems.length} problem(s)`);
    process.exit(1);
  }
  console.log("docs check: ok");
}
