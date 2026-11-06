import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

// The InjectedScript of the Playwright that @ayme-dev/playwright-lite pins
// (ADR-0021), as Playwright's own build generates it: the artifact the
// pinned Lite tag commits as build/generated/injectedScriptSource.ts,
// copied byte for byte. `pnpm --filter @ayme-dev/ayme sync:injected` copies
// it again from the tag package.json pins; a new pin changes these two
// values after its artifact is reviewed, as Lite's own build does.
const expectedBytes = 331512;
const expectedSha256 =
  "8517fd96ce7384ba9068116c21ebe3e2d0b61d123483df938b15aa4382ad92df";

/** One edit of the pinned source, which must match exactly `count` times. */
type Edit = { find: string; replace: string; count: number; why: string };

const edits: Edit[] = [
  {
    why: "an ES module exporting only the dual capture, so the build drops the rest of the InjectedScript",
    find: [
      "var injectedScript_exports = {};",
      "__export(injectedScript_exports, {",
      "  InjectedScript: () => InjectedScript",
      "});",
      "module.exports = __toCommonJS(injectedScript_exports);",
    ].join("\n"),
    replace: "",
    count: 1,
  },
  {
    why: "no module-level ref counter: the document's slot counts",
    find: "var lastRef = 0;\n",
    replace: "",
    count: 1,
  },
  {
    why: "the ai mode carries the document's marks and counter to every node",
    find: "      refPrefix: options.refPrefix,\n",
    replace:
      "      refPrefix: options.refPrefix,\n      aymeRefs: options.aymeRefs,\n",
    count: 1,
  },
  {
    why: "marks private to Ayme's module, never Playwright's `_ariaRef` expando",
    find: "let ariaRef = element._ariaRef;",
    replace: "let ariaRef = options.aymeRefs.marks.get(element);",
    count: 1,
  },
  {
    why: "marks private to Ayme's module, never Playwright's `_ariaRef` expando",
    find: "element._ariaRef = ariaRef;",
    replace: "options.aymeRefs.marks.set(element, ariaRef);",
    count: 1,
  },
  {
    why: "refs counted once per document, in its slot",
    find: '"e" + ++lastRef',
    replace: '"e" + options.aymeRefs.next()',
    count: 1,
  },
];

/**
 * `virtual:ayme-aria-snapshot`: Playwright's `captureAriaSnapshot` from the
 * pinned InjectedScript, as an ES module whose marks and ref counter come
 * from its caller: `captureAriaSnapshot(root, { mode: "ai", aymeRefs })`.
 * Playwright Lite's and stock Playwright's copies keep their own; this one
 * never reads or writes theirs. It also exports Playwright's `isElementVisible`,
 * the visibility `locator.isVisible()` reads.
 */
export function pinnedAriaSnapshotModule(): string {
  let source = readPinnedSource();
  for (const { find, replace, count, why } of edits) {
    const found = source.split(find).length - 1;
    if (found !== count)
      throw new Error(
        `The pinned InjectedScript has ${found} of ${JSON.stringify(find)} where Ayme's build expects ${count} (${why}).`
      );
    source = source.replaceAll(find, replace);
  }
  for (const left of ["_ariaRef", "lastRef", "injectedScript_exports"])
    if (source.includes(left))
      throw new Error(`The pinned InjectedScript still uses ${left}.`);
  return `${source}\nexport { captureAriaSnapshot, isElementVisible };\n`;
}

function readPinnedSource(): string {
  const artifact = readFileSync(
    new URL("./generated/injectedScriptSource.ts", import.meta.url)
  );
  const sha256 = createHash("sha256").update(artifact).digest("hex");
  if (artifact.byteLength !== expectedBytes || sha256 !== expectedSha256)
    throw new Error(
      "The pinned Playwright InjectedScript artifact does not match the reviewed one."
    );
  const text = artifact.toString("utf8");
  const prefix = "export const source = ";
  if (!text.startsWith(prefix) || !text.endsWith(";"))
    throw new Error("Unsupported InjectedScript artifact format.");
  const source: unknown = JSON.parse(text.slice(prefix.length, -1));
  if (typeof source !== "string")
    throw new Error("The InjectedScript source must be a string.");
  return source;
}
