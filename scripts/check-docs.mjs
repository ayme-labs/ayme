/**
 * Checks the consumer docs in `docs/guide/`, every README and the Markdown
 * files at the repository root.
 *
 *   node scripts/check-docs.mjs    check the repository, print each problem
 *
 * It fails when
 * - a relative link does not resolve to a file or directory,
 * - a link's `#fragment` into a Markdown file names no heading in it, using
 *   the anchors GitHub and the docs site give headings,
 * - a relative link in a page under `docs/guide/` leaves `docs/guide/`, since
 *   the docs site serves only that directory,
 * - a `github.com/ayme-labs/ayme/blob/main/...` or `tree/main/...` link does
 *   not resolve to a path in the repository,
 * - a page under `docs/guide/` is not linked from its index, `README.md`,
 * - a page under `docs/guide/` does not open with an H1 title followed by a
 *   one-sentence description paragraph,
 * - the README of a published package (one under `packages/` that is not
 *   private) contains a bare issue reference, a relative link or a banned
 *   phrase, since npm shows it without the repository around it,
 * - a published package's source marks an API `@experimental` that the
 *   Experimental APIs page does not list, or the page lists one that no
 *   published package marks (ADR-0037). The page lists an API as a list item
 *   that opens with a code span, by its last name, in each package the item
 *   names in a later code span: ``- `ayme.peek(...)` in `@ayme-dev/ayme` ``
 *   lists `peek` in `@ayme-dev/ayme`. An item that names no package fails.
 *
 * Code spans and fenced code blocks are ignored. Uses only `node:` modules.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const GUIDE_DIR = "docs/guide";
const EXPERIMENTAL_PAGE = `${GUIDE_DIR}/reference/experimental-apis.md`;
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

/** The packages npm publishes, those not marked private, as `packages/<dir>` and their npm name. */
function publishedPackages(root) {
  const packages = path.join(root, "packages");
  if (!fs.existsSync(packages)) return [];
  return fs.readdirSync(packages).flatMap((dir) => {
    const manifest = path.join(packages, dir, "package.json");
    if (!fs.existsSync(manifest)) return [];
    const { name, private: internal } = JSON.parse(
      fs.readFileSync(manifest, "utf8")
    );
    return internal ? [] : [{ dir: `packages/${dir}`, name }];
  });
}

/** Each API a published package's source marks `@experimental`, by name and package. */
function experimentalMarks(root) {
  const marks = [];
  for (const { dir, name: pkg } of publishedPackages(root)) {
    const src = path.join(root, dir, "src");
    if (!fs.existsSync(src)) continue;
    for (const entry of fs.readdirSync(src, { recursive: true })) {
      if (!/\.tsx?$/.test(entry) || entry.includes("node_modules")) continue;
      const file = path.posix.join(dir, "src", entry.split(path.sep).join("/"));
      const text = fs.readFileSync(path.join(root, file), "utf8");
      for (const comment of text.matchAll(/\/\*\*([\s\S]*?)\*\/\s*/g)) {
        if (!/(?:^|\s)@experimental\b/.test(comment[1])) continue;
        // The declaration the comment documents: an export, or a member.
        const declaration =
          /(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:async\s+)?(?:(?:function\*?|const|let|type|interface|class|readonly)\s+)?([A-Za-z_$][\w$]*)/y;
        declaration.lastIndex = comment.index + comment[0].length;
        const name = declaration.exec(text)?.[1];
        if (name)
          marks.push({
            name,
            pkg,
            file,
            line: lineOf(text, declaration.lastIndex),
          });
      }
    }
  }
  return marks;
}

/** The APIs the Experimental APIs page lists, by their last name and the published packages the item names. */
function experimentalListing(root) {
  const page = path.join(root, EXPERIMENTAL_PAGE);
  if (!fs.existsSync(page)) return [];
  const published = publishedPackages(root).map(({ name }) => name);
  return fs
    .readFileSync(page, "utf8")
    .split("\n")
    .flatMap((text, index) => {
      if (!/^\s*[-*+]\s+`/.test(text)) return [];
      const [span, ...rest] = [...text.matchAll(/`([^`]+)`/g)].map(
        (match) => match[1]
      );
      const name = span.replace(/\(.*$/s, "").split(".").pop().trim();
      // A subpath export such as `@ayme-dev/ayme/server` is its package.
      const packages = published.filter((pkg) =>
        rest.some((other) => other === pkg || other.startsWith(`${pkg}/`))
      );
      return [{ name, packages, line: index + 1 }];
    });
}

/** READMEs of the packages npm publishes. */
function publishedReadmes(root) {
  return new Set(publishedPackages(root).map(({ dir }) => `${dir}/README.md`));
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

/** The anchor GitHub and the docs site give a heading's text. */
function slug(heading) {
  return (
    heading
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      // Outside code spans, drop HTML tags and the underscores of `_emphasis_`.
      .split(/(`+[^`]*`+)/)
      .map((part, index) =>
        index % 2
          ? part
          : part
              .replace(/<[^>]*>/g, "")
              .replace(/(?<![\p{L}\p{N}])_+|_+(?![\p{L}\p{N}])/gu, "")
      )
      .join("")
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
      .replace(/ /g, "-")
  );
}

/** The anchors of a Markdown file's ATX and setext headings, repeats suffixed `-1`, `-2` as GitHub does. */
function anchors(raw) {
  const lines = raw.split("\n");
  const found = new Set();
  const add = (text) => {
    const base = slug(text);
    let anchor = base;
    for (let count = 1; found.has(anchor); count++) anchor = `${base}-${count}`;
    found.add(anchor);
  };
  prose(raw)
    .split("\n")
    .forEach((line, index, proseLines) => {
      if (/^ {0,3}#{1,6}(\s|$)/.test(line))
        add(lines[index].replace(/^ {0,3}#{1,6}\s*|(\s+#+)?\s*$/g, ""));
      else if (
        line.trim() !== "" &&
        /^ {0,3}(=+|-+)\s*$/.test(proseLines[index + 1] ?? "")
      )
        add(lines[index].trim());
    });
  return found;
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
    (file) =>
      path.posix.basename(file) === "README.md" ||
      !file.includes("/") ||
      pages.includes(file)
  );
  const indexed = new Set();
  const anchorsOf = new Map();
  const hasAnchor = (linked, fragment) => {
    if (!anchorsOf.has(linked))
      anchorsOf.set(linked, anchors(fs.readFileSync(linked, "utf8")));
    try {
      return anchorsOf.get(linked).has(decodeURIComponent(fragment));
    } catch {
      return false; // a malformed escape such as `%` names no heading
    }
  };

  for (const file of checked) {
    const text = prose(fs.readFileSync(path.join(root, file), "utf8"));
    const isPublished = published.has(file);
    for (const { target, line } of links(text)) {
      const linked = linkedPath(root, file, target);
      if (linked !== undefined && !fs.existsSync(linked))
        report(file, line, `link does not resolve: ${target}`);
      const fragment = /#(.+)$/.exec(target)?.[1];
      const anchored = target.startsWith("#") ? path.join(root, file) : linked;
      if (
        fragment !== undefined &&
        anchored?.endsWith(".md") &&
        fs.existsSync(anchored) &&
        !hasAnchor(anchored, fragment)
      )
        report(file, line, `link names no heading in its target: ${target}`);
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

  const marks = experimentalMarks(root);
  const listing = experimentalListing(root);
  const listed = new Set(
    listing.flatMap(({ name, packages }) =>
      packages.map((pkg) => `${name} ${pkg}`)
    )
  );
  const marked = new Set(marks.map(({ name, pkg }) => `${name} ${pkg}`));
  for (const { name, pkg, file, line } of marks)
    if (!listed.has(`${name} ${pkg}`))
      report(
        file,
        line,
        `\`${name}\` in ${pkg} is marked @experimental but not listed in ${EXPERIMENTAL_PAGE}`
      );
  for (const { name, packages, line } of listing) {
    if (packages.length === 0)
      report(
        EXPERIMENTAL_PAGE,
        line,
        `lists \`${name}\` without naming a published package it is in`
      );
    for (const pkg of packages)
      if (!marked.has(`${name} ${pkg}`))
        report(
          EXPERIMENTAL_PAGE,
          line,
          `lists \`${name}\` in ${pkg}, which does not mark it @experimental`
        );
  }

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
