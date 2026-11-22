/**
 * Fails on the name "Ayme". The product and the company, ayme labs, are
 * written in lowercase, at the start of a sentence and in headings too.
 *
 *   node scripts/check-name.mjs    check every tracked text file
 *
 * A capital is allowed only where code needs one:
 * - an identifier, such as the `Ayme` type, in a script file, a Vue, Svelte or
 *   HTML `<script>`, or a code block of one of those in Markdown. A comment, a
 *   string and JSX text are not identifiers,
 * - the Markdown code span `Ayme`, which names the type.
 *
 * Part of a longer word, such as `AymeProvider` or `AYME_PORT`, is not the name.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

/** Files that hold the capital as data. */
const EXEMPT = [
  // The release tooling writes them from commit messages, old ones included.
  /(^|\/)CHANGELOG\.md$/,
  // Source text that names the type, in strings.
  /^packages\/ayme\/src\/layout\.test\.ts$/,
  // The rule itself.
  /^scripts\/check-name(\.test)?\.mjs$/,
];

// A letter or digit before it makes it part of a word, unless an escape such as `\n` ends there.
const NAME =
  /(?<!(?<!\\)[A-Za-z0-9])(?:Ayme(?![A-Za-z0-9])|ayme Labs(?![A-Za-z0-9]))/g;
const SCRIPT = /^(?:[cm]?[jt]sx?)$/;
const LANGUAGE = { typescript: "ts", javascript: "js" };
const SCRIPT_ELEMENT = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;
/** A fenced code block, which may be indented, in a list item or quoted. */
const FENCE =
  /^(?:[ \t>]|[-*+] |\d+[.)] )*((`)\2{2,}|(~)\3{2,})[ \t]*([\w-]*)[^\n]*\n([\s\S]*?)(?:^[ \t>]*\1(?:\2|\3)*[ \t]*\r?$|(?![\s\S]))/gm;

const blank = (text) => text.replace(/[^\n]/g, " ");
/** `part` of `text` at its own offset, with everything before it blank. */
const inPlace = (text, start, part) => blank(text.slice(0, start)) + part;

/** The `<script>` elements in `text` that hold script, by their language. */
function scriptElements(text) {
  const markup = text.replace(/<!--[\s\S]*?-->/g, blank);
  return [...markup.matchAll(SCRIPT_ELEMENT)].flatMap((match) => {
    const [element, attributes, body] = match;
    const type = /\btype=["']([^"']*)/.exec(attributes)?.[1] ?? "module";
    if (!/^$|^module$|javascript$/.test(type)) return [];
    const lang = /\blang=["'](\w+)/.exec(attributes)?.[1] ?? "js";
    const start = match.index + element.indexOf(">") + 1;
    return [{ lang, source: inPlace(text, start, body) }];
  });
}

/** Each part of `text` that is script, at its own offset, by its language. */
function scripts(lang, text) {
  if (SCRIPT.test(lang)) return [{ lang, source: text }];
  if (/^(?:vue|svelte|html)$/.test(lang)) return scriptElements(text);
  if (lang !== "md") return [];
  return [...text.matchAll(FENCE)].flatMap((match) => {
    const [block, , , , info, body] = match;
    const start = match.index + block.indexOf("\n") + 1;
    const unquoted = body.replace(/^[ \t>]+/gm, blank);
    const name = info.toLowerCase();
    const inner = LANGUAGE[name] ?? name;
    // Markdown inside a block is text.
    return inner === "md" ? [] : scripts(inner, inPlace(text, start, unquoted));
  });
}

/** The `[start, end)` ranges of `text` where a capital is allowed. */
function allowed(file, text) {
  const ranges = [];
  const lang = path.extname(file).slice(1);
  for (const script of scripts(lang, text)) {
    const parsed = ts.createSourceFile(
      `script.${script.lang}`,
      script.source,
      ts.ScriptTarget.Latest
    );
    const nodes = [parsed];
    for (let node = nodes.pop(); node; node = nodes.pop()) {
      if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node))
        ranges.push([node.getStart(parsed), node.end]);
      ts.forEachChild(node, (child) => {
        nodes.push(child);
      });
    }
  }
  if (lang === "md")
    for (const match of text
      .replace(FENCE, blank)
      .matchAll(/(?<!`)`Ayme`(?!`)/g))
      ranges.push([match.index, match.index + match[0].length]);
  return ranges;
}

/** The 1-based line of each name in `text` that should be in lowercase. */
export function capitalizedNames(file, text) {
  if (EXEMPT.some((pattern) => pattern.test(file))) return [];
  const names = [...text.matchAll(NAME)];
  if (names.length === 0) return [];
  const ranges = allowed(file, text);
  return names
    .filter(
      ({ index }) =>
        !ranges.some(([start, end]) => start <= index && index < end)
    )
    .map(({ index }) => text.slice(0, index).split("\n").length);
}

/** Every problem in the tracked text files under `root`, as `file:line: message` strings. */
export function checkName(root) {
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" });
  // `-I` leaves binary files out, and the patterns files without the name.
  let files;
  try {
    files = git("grep", "-zlI", "-e", "Ayme", "-e", "ayme Labs")
      .split("\0")
      .filter(Boolean);
  } catch (error) {
    if (error.status === 1) return []; // no file has it
    throw error;
  }
  return files.flatMap((file) =>
    capitalizedNames(file, fs.readFileSync(path.join(root, file), "utf8")).map(
      (line) => `${file}:${line}: write "ayme" and "ayme labs" in lowercase`
    )
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const problems = checkName(root);
  for (const problem of problems) console.error(problem);
  if (problems.length > 0) {
    console.error(`name check: ${problems.length} problem(s)`);
    process.exit(1);
  }
  console.log("name check: ok");
}
