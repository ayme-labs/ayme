import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { checkDocs, skillReferenceText } from "./check-docs.mjs";

const roots = [];
after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

const PAGE = "# A page\n\nWhat this page is for, in one sentence.\n";

/** A repository that passes the check, with `changes` written over it. */
function fixture(changes = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "check-docs-"));
  roots.push(root);
  const files = {
    "docs/guide/README.md": `# Guide\n\nEvery page, in sidebar order.\n\n- [A page](start/page.md)\n`,
    "docs/guide/start/page.md": `${PAGE}\nSee [the index](../README.md), [a section](#a-page) and [npm](https://www.npmjs.com/).\n`,
    "packages/lib/package.json": `{ "name": "lib" }`,
    "packages/lib/README.md": `# lib\n\nSee [the guide](https://github.com/ayme-labs/ayme/blob/main/docs/guide/start/page.md), [the package](https://github.com/ayme-labs/ayme/tree/main/packages/lib) and [usage](#usage).\n\nIssue https://github.com/ayme-labs/ayme/issues/12 is fine.\n\n\`[not a link](gone.md) #12\` in code:\n\n\`\`\`sh\n#12 and [no link](gone.md)\n# Not a heading\n\`\`\`\n\n## Usage\n`,
    "packages/internal/package.json": `{ "name": "internal", "private": true }`,
    "packages/internal/README.md": `# internal\n\nSee [the license](../../LICENSE) and #12.\n`,
    LICENSE: "license\n",
    ...changes,
  };
  for (const [file, contents] of Object.entries(files)) {
    if (contents === undefined) continue;
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), contents);
  }
  return root;
}

function assertOneProblem(changes, expected) {
  const problems = checkDocs(fixture(changes));
  assert.equal(problems.length, 1, problems.join("\n"));
  assert.match(problems[0], expected);
}

test("passes a repository that follows the rules", () => {
  assert.deepEqual(checkDocs(fixture()), []);
});

test("passes skills that ship identical copies of the shared references", () => {
  assert.deepEqual(
    checkDocs(
      fixture({
        "skills/shared/guide.md": "# Guide\n",
        "skills/one/SKILL.md": "---\nname: one\n---\n",
        "skills/one/references/guide.md": "# Guide\n",
      })
    ),
    []
  );
});

test("passes product-surfaces without a copy of the shared references", () => {
  assert.deepEqual(
    checkDocs(
      fixture({
        "skills/shared/guide.md": "# Guide\n",
        "skills/product-surfaces/SKILL.md":
          "---\nname: product-surfaces\n---\n",
      })
    ),
    []
  );
});

test("fails a skill whose copy of a shared reference is missing or differs", () => {
  const problems = checkDocs(
    fixture({
      "skills/shared/guide.md": "# Guide\n",
      "skills/one/SKILL.md": "---\nname: one\n---\n",
      "skills/one/references/guide.md": "# Old guide\n",
      "skills/two/SKILL.md": "---\nname: two\n---\n",
    })
  );
  assert.deepEqual(problems, [
    "skills/one/references/guide.md:1: differs from skills/shared/guide.md; run pnpm skills:sync and commit the copy",
    "skills/two/references/guide.md:1: differs from skills/shared/guide.md; run pnpm skills:sync and commit the copy",
  ]);
});

test("fails on a skill's copy of a guide page whose source is gone", () => {
  assert.deepEqual(
    checkDocs(fixture({ "skills/ayme/references/ayme-page-objects.md": PAGE })),
    [
      "skills/ayme/references/ayme-page-objects.md:1: copies docs/guide/guides/ayme-page-objects.md, which does not exist; remove the copy or fix the source",
    ]
  );
});

test("points a guide page's titled and reference-style links at GitHub in a skill's copy", () => {
  const root = fixture({
    "docs/guide/guides/ayme-page-objects.md": `${PAGE}\nSee [a page](../start/page.md "A page"), [npm](https://www.npmjs.com/) and [the index][index].\n\n[index]: ../README.md "Guide"\n`,
  });
  assert.equal(
    skillReferenceText(root, "docs/guide/guides/ayme-page-objects.md"),
    `${PAGE}\nSee [a page](https://github.com/ayme-labs/ayme/blob/main/docs/guide/start/page.md "A page"), [npm](https://www.npmjs.com/) and [the index][index].\n\n[index]: https://github.com/ayme-labs/ayme/blob/main/docs/guide/README.md "Guide"\n`
  );
});

test("checks a skill's copy of a guide page, with its relative links pointing at GitHub", () => {
  const guide = {
    "docs/guide/README.md": `# Guide\n\nEvery page, in sidebar order.\n\n- [A page](start/page.md)\n- [Models](guides/ayme-page-objects.md)\n`,
    "docs/guide/guides/ayme-page-objects.md": `${PAGE}\nSee [a page](../start/page.md#a-page) and [below](#a-page).\n`,
  };
  const copy = `${PAGE}\nSee [a page](https://github.com/ayme-labs/ayme/blob/main/docs/guide/start/page.md#a-page) and [below](#a-page).\n`;
  assert.deepEqual(
    checkDocs(
      fixture({
        ...guide,
        "skills/ayme/references/ayme-page-objects.md": copy,
      })
    ),
    []
  );
  assert.deepEqual(checkDocs(fixture(guide)), [
    "skills/ayme/references/ayme-page-objects.md:1: differs from docs/guide/guides/ayme-page-objects.md; run pnpm skills:sync and commit the copy",
  ]);
});

test("fails on a link in a skill that does not resolve or names no heading", () => {
  const problems = checkDocs(
    fixture({
      "skills/one/SKILL.md":
        "---\nname: one\n---\n\nRead [the guide](references/guide.md#gone) and [more](references/more.md).\n",
      "skills/one/references/guide.md": "# Guide\n",
    })
  );
  assert.deepEqual(problems, [
    "skills/one/SKILL.md:5: link names no heading in its target: references/guide.md#gone",
    "skills/one/SKILL.md:5: link does not resolve: references/more.md",
  ]);
});

test("skips a submodule's own docs", () => {
  assert.deepEqual(
    checkDocs(
      fixture({
        "apps/lab/upstream/.git": "gitdir: ../../../.git/modules/upstream\n",
        "apps/lab/upstream/README.md": "# Upstream\n\nSee [gone](gone.md).\n",
      })
    ),
    []
  );
});

test("treats a fence line with an info string as code, not as a closing fence", () => {
  assert.deepEqual(
    checkDocs(
      fixture({
        "packages/lib/README.md":
          "# lib\n\n```md\n```js\n#12 [no link](gone.md)\n```\n",
      })
    ),
    []
  );
});

test("fails on a relative link that does not resolve", () => {
  assertOneProblem(
    { "apps/demo/README.md": "# demo\n\n[Setup](docs/setup.md#start)\n" },
    /^apps\/demo\/README\.md:3: link does not resolve: docs\/setup\.md#start$/
  );
});

test("fails on a relative link in a root Markdown file that does not resolve", () => {
  assertOneProblem(
    {
      "ARCHITECTURE.md":
        "# Architecture\n\nSee [the runtime](packages/ayme/src/gone.ts).\n",
    },
    /^ARCHITECTURE\.md:3: link does not resolve: packages\/ayme\/src\/gone\.ts$/
  );
});

test("fails on a relative link in a guide page that does not resolve", () => {
  assertOneProblem(
    { "docs/guide/start/page.md": `${PAGE}\n[Next](next.md)\n` },
    /^docs\/guide\/start\/page\.md:5: link does not resolve: next\.md$/
  );
});

test("fails on a relative link in a guide page that leaves docs/guide", () => {
  assertOneProblem(
    { "docs/guide/start/page.md": `${PAGE}\n[License](../../../LICENSE)\n` },
    /^docs\/guide\/start\/page\.md:5: link leaves docs\/guide, the docs site cannot serve it; use a github\.com\/ayme-labs\/ayme\/blob\/main\/ link: \.\.\/\.\.\/\.\.\/LICENSE$/
  );
});

test("fails on a repository link that does not resolve", () => {
  assertOneProblem(
    {
      "packages/lib/README.md":
        "# lib\n\n[Gone](https://github.com/ayme-labs/ayme/blob/main/docs/gone.md)\n",
    },
    /^packages\/lib\/README\.md:3: link does not resolve: https:\/\/github\.com\/ayme-labs\/ayme\/blob\/main\/docs\/gone\.md$/
  );
});

test("fails on a link to a heading the page does not have", () => {
  assertOneProblem(
    { "docs/guide/start/page.md": `${PAGE}\n[Gone](#gone)\n` },
    /^docs\/guide\/start\/page\.md:5: link names no heading in its target: #gone$/
  );
});

test("fails on a link to a heading another page does not have", () => {
  assertOneProblem(
    {
      "docs/guide/README.md": `# Guide\n\nEvery page, in sidebar order.\n\n- [A page](start/page.md#gone)\n`,
    },
    /^docs\/guide\/README\.md:5: link names no heading in its target: start\/page\.md#gone$/
  );
});

test("fails on a repository link to a heading the page does not have", () => {
  assertOneProblem(
    {
      "packages/lib/README.md":
        "# lib\n\n[Gone](https://github.com/ayme-labs/ayme/blob/main/docs/guide/start/page.md#gone)\n",
    },
    /^packages\/lib\/README\.md:3: link names no heading in its target: https:\/\/github\.com\/ayme-labs\/ayme\/blob\/main\/docs\/guide\/start\/page\.md#gone$/
  );
});

test("fails on a link to a heading that is only inside a code block", () => {
  assertOneProblem(
    {
      "docs/guide/start/page.md": `${PAGE}\n[Code](#not-a-heading)\n\n\`\`\`sh\n# Not a heading\n\`\`\`\n`,
    },
    /^docs\/guide\/start\/page\.md:5: link names no heading in its target: #not-a-heading$/
  );
});

test("names headings as GitHub does", () => {
  assert.deepEqual(
    checkDocs(
      fixture({
        "docs/guide/start/page.md": `${PAGE}\n## \`createAyme()\` and [links](../README.md)!\n\n## _Emphasis_ and snake_case\n\n## \`Ref<T>\` and \`__init__\`\n\n## Usage\n\n## Usage-1\n\n## Usage\n\nSetext\n------\n\nSee [it](#createayme-and-links), [this](#emphasis-and-snake_case), [code](#reft-and-__init__), [repeat](#usage-2), [setext](#setext) and [Unicode](#déjà-vu).\n\n### Déjà vu ###\n`,
      })
    ),
    []
  );
});

test("fails on a fragment with a malformed escape instead of throwing", () => {
  assertOneProblem(
    { "docs/guide/start/page.md": `${PAGE}\n[Bad](#bad%)\n` },
    /^docs\/guide\/start\/page\.md:5: link names no heading in its target: #bad%$/
  );
});

test("fails on a guide page missing from the index", () => {
  assertOneProblem(
    { "docs/guide/guides/extra.md": PAGE },
    /^docs\/guide\/guides\/extra\.md:1: page is not listed in docs\/guide\/README\.md$/
  );
});

test("fails on a guide page that does not open with an H1", () => {
  assertOneProblem(
    {
      "docs/guide/start/page.md":
        "---\ntitle: A page\n---\n\nWhat this page is for.\n",
    },
    /^docs\/guide\/start\/page\.md:1: does not open with an H1 title$/
  );
});

test("fails on a guide page without a description paragraph", () => {
  assertOneProblem(
    { "docs/guide/start/page.md": "# A page\n\n## Section\n" },
    /^docs\/guide\/start\/page\.md:1: has no description paragraph after its title$/
  );
});

test("fails on a description of more than one sentence", () => {
  assertOneProblem(
    {
      "docs/guide/start/page.md":
        "# A page\n\nWhat this page is for.\nAnd a second sentence.\n",
    },
    /^docs\/guide\/start\/page\.md:1: description paragraph is not one sentence$/
  );
});

test("fails on a bare issue reference in a published README", () => {
  assertOneProblem(
    { "packages/lib/README.md": "# lib\n\nFixed in #12.\n" },
    /^packages\/lib\/README\.md:3: bare issue reference in a published README: #12$/
  );
});

test("fails on a relative link in a published README", () => {
  assertOneProblem(
    {
      "packages/lib/README.md": "# lib\n\n[License](../../LICENSE)\n",
    },
    /^packages\/lib\/README\.md:3: relative link in a published README, npm cannot resolve it: \.\.\/\.\.\/LICENSE$/
  );
});

test("fails on a banned phrase in a published README", () => {
  assertOneProblem(
    {
      "packages/lib/README.md":
        "# lib\n\nThis prototype does not certify edge deployment.\n",
    },
    /^packages\/lib\/README\.md:3: banned phrase in a published README: "prototype does not certify"$/
  );
});

const EXPERIMENTAL = "docs/guide/reference/experimental-apis.md";
const experimentalPage = (list) => ({
  "docs/guide/README.md": `# Guide\n\nEvery page, in sidebar order.\n\n- [A page](start/page.md)\n- [Experimental APIs](reference/experimental-apis.md)\n`,
  [EXPERIMENTAL]: `# Experimental APIs\n\nThe APIs whose shape is not settled yet.\n\n${list}`,
});
const tagged = `/** Reads state. */\nexport function readState(): void {}\n\nexport type Options = {\n  /**\n   * Turns the loop on.\n   * @experimental\n   */\n  loop?: () => void;\n};\n\n/** @experimental */\nexport default function loader() {}\n`;

for (const extension of ["ts", "tsx"]) {
  test(`ignores screenshot directories ending in .${extension} and still detects experimental source`, () => {
    const screenshot = `packages/lib/src/shared/__screenshots__/case.browser.test.${extension}/failure.png`;
    const source = `packages/lib/src/nested/api.${extension}`;
    const root = fixture({
      [screenshot]: "failure evidence\n",
      [source]: "/** @experimental */\nexport function preview() {}\n",
    });

    assert.deepEqual(checkDocs(root), [
      `${source}:2: ` +
        "`preview` in lib is marked @experimental but not listed in docs/guide/reference/experimental-apis.md",
    ]);
    assert.equal(
      fs.readFileSync(path.join(root, screenshot), "utf8"),
      "failure evidence\n"
    );
  });
}

test("passes when the page lists every API a published package marks experimental", () => {
  assert.deepEqual(
    checkDocs(
      fixture({
        "packages/lib/src/index.ts": tagged,
        ...experimentalPage(
          "- `options.loop(read, name?)` in `lib/server`: turns the loop on with `x`.\n- `loader` in `lib`: the loader.\n"
        ),
      })
    ),
    []
  );
});

test("fails on an API marked experimental that the page does not list", () => {
  assertOneProblem(
    {
      "packages/lib/src/index.ts": tagged,
      ...experimentalPage("- `loader` in `lib`: the loader.\n"),
    },
    /^packages\/lib\/src\/index\.ts:9: `loop` in lib is marked @experimental but not listed in docs\/guide\/reference\/experimental-apis\.md$/
  );
});

test("fails on a listed API that no published package marks experimental", () => {
  assertOneProblem(
    {
      "packages/lib/src/index.ts": tagged,
      ...experimentalPage(
        "- `loop` in `lib`: the loop.\n- `loader` in `lib`: the loader.\n- `readState()` in `lib`: settled.\n"
      ),
    },
    /^docs\/guide\/reference\/experimental-apis\.md:7: lists `readState` in lib, which does not mark it @experimental$/
  );
});

test("tells apart APIs of the same name in different packages", () => {
  assert.deepEqual(
    checkDocs(
      fixture({
        "packages/lib/src/index.ts": tagged,
        "packages/other/package.json": `{ "name": "other" }`,
        "packages/other/src/index.ts": "export function loader() {}\n",
        ...experimentalPage(
          "- `loop` in `lib`: the loop.\n- `loader` in `other`: the loader.\n"
        ),
      })
    ),
    [
      "packages/lib/src/index.ts:13: `loader` in lib is marked @experimental but not listed in docs/guide/reference/experimental-apis.md",
      "docs/guide/reference/experimental-apis.md:6: lists `loader` in other, which does not mark it @experimental",
    ]
  );
});

test("fails on a listed API that names no published package", () => {
  assertOneProblem(
    {
      "packages/lib/src/index.ts": tagged,
      ...experimentalPage(
        "- `loop` in `lib`: the loop.\n- `loader` in `lib`: the loader.\n- `loader` in `internal`: private.\n"
      ),
    },
    /^docs\/guide\/reference\/experimental-apis\.md:7: lists `loader` without naming a published package it is in$/
  );
});

const usage =
  "export const USAGE = `Usage: tool serve [--port <port>] [--entry <file>]\n\n  --port <port>  Listen on this port.\n  -e, --entry <file>\n                 Experimental: serve this entry.\n  --watch        Experimental: rebuild on change.\n  -h, --help     Print this usage text.\n`;\n";

test("passes when the page lists every flag a published package's usage text marks experimental", () => {
  assert.deepEqual(
    checkDocs(
      fixture({
        "packages/lib/src/cli.ts": usage,
        ...experimentalPage(
          "- `--entry <file>` of `tool serve` in `lib`: the entry.\n- `--watch` of `tool serve` in `lib`: rebuilds.\n"
        ),
      })
    ),
    []
  );
});

test("reads a usage text with CRLF line endings", () => {
  assert.deepEqual(
    checkDocs(
      fixture({
        "packages/lib/src/cli.ts": usage.replaceAll("\n", "\r\n"),
        ...experimentalPage(
          "- `--entry <file>` of `tool serve` in `lib`: the entry.\n- `--watch` of `tool serve` in `lib`: rebuilds.\n"
        ),
      })
    ),
    []
  );
});

test("ignores experimental marks in a published package's test files", () => {
  assert.deepEqual(
    checkDocs(
      fixture({
        "packages/lib/src/cli.test.ts": usage,
        "packages/lib/src/index.test.ts": tagged,
      })
    ),
    []
  );
});

test("fails on a flag the usage text marks experimental that the page does not list", () => {
  assertOneProblem(
    {
      "packages/lib/src/cli.ts": usage,
      ...experimentalPage("- `--watch` of `tool serve` in `lib`: rebuilds.\n"),
    },
    /^packages\/lib\/src\/cli\.ts:4: `--entry` in lib is marked experimental in its usage text but not listed in docs\/guide\/reference\/experimental-apis\.md$/
  );
});

test("fails on a listed flag that no published package's usage text marks experimental", () => {
  assertOneProblem(
    {
      "packages/lib/src/cli.ts": usage,
      ...experimentalPage(
        "- `--entry <file>` of `tool serve` in `lib`: the entry.\n- `--watch` of `tool serve` in `lib`: rebuilds.\n- `--port <port>` of `tool serve` in `lib`: settled.\n"
      ),
    },
    /^docs\/guide\/reference\/experimental-apis\.md:7: lists `--port` in lib, which does not mark it experimental in its usage text$/
  );
});

test("ignores the experimental mark in a private package", () => {
  assert.deepEqual(
    checkDocs(
      fixture({
        "packages/internal/src/index.ts": tagged,
        "packages/internal/src/cli.ts": usage,
      })
    ),
    []
  );
});

const PARAMETER_PROPERTY =
  "constructor parameter property, which erasableSyntaxOnly rejects; declare the field on the class and assign it in the constructor";

test("fails on a constructor parameter property in a TypeScript example", () => {
  assert.deepEqual(
    checkDocs(
      fixture({
        "docs/guide/start/page.md": `# A page\n\nWhat this page is for, in one sentence.\n\n\`\`\`ts\nclass AppPage {\n  constructor(readonly page: Page) {}\n}\n\`\`\`\n`,
      })
    ),
    [`docs/guide/start/page.md:7: ${PARAMETER_PROPERTY}`]
  );
});

test("reports each constructor parameter modifier on its own line", () => {
  assert.deepEqual(
    checkDocs(
      fixture({
        "docs/guide/start/page.md": `# A page\n\nWhat this page is for, in one sentence.\n\n\`\`\`ts\nclass AppPage {\n  constructor(\n    private readonly page: Page,\n  ) {}\n}\n\`\`\`\n\n\`\`\`tsx title="widget"\nclass Widget {\n  constructor(protected page: Page, public readonly name: string) {}\n}\n\`\`\`\n\n\`\`\`typescript\nclass Sub {\n  constructor(override page: Page) {}\n}\n\`\`\`\n\n~~~ts\nclass Tilde {\n  constructor(@Inject(TOKEN) private page: Page) {}\n}\n~~~\n`,
      })
    ),
    [
      `docs/guide/start/page.md:8: ${PARAMETER_PROPERTY}`,
      `docs/guide/start/page.md:15: ${PARAMETER_PROPERTY}`,
      `docs/guide/start/page.md:15: ${PARAMETER_PROPERTY}`,
      `docs/guide/start/page.md:21: ${PARAMETER_PROPERTY}`,
      `docs/guide/start/page.md:27: ${PARAMETER_PROPERTY}`,
    ]
  );
});

test("passes a TypeScript example that declares the field and assigns it", () => {
  assert.deepEqual(
    checkDocs(
      fixture({
        "docs/guide/start/page.md": `# A page\n\nWhat this page is for, in one sentence.\n\n\`\`\`ts\nclass AppPage {\n  readonly page: Page;\n  constructor(page: Page) {\n    this.page = page;\n  }\n}\nclass Row {\n  constructor(page: Readonly<Page>, options: { readonly id: string }) {}\n}\nconst sample = "constructor(readonly page: Page)";\n// constructor(readonly page: Page)\n\`\`\`\n\n\`constructor(readonly page: Page)\` in a span.\n\n\`\`\`text\nconstructor(private readonly page: Page) {}\n\`\`\`\n`,
        "packages/lib/README.md": `# lib\n\n\`\`\`ts\nclass ProjectsPage {\n  private readonly page: Page;\n  constructor(page: Page) {\n    this.page = page;\n  }\n}\n\`\`\`\n\n## Usage\n`,
        "skills/ayme/references/model.md":
          '```ts\nclass LoginPage {\n  private readonly page: Page;\n  constructor(page: Page) {\n    this.page = page;\n  }\n  get submit() {\n    return this.page.getByRole("button");\n  }\n}\n```\n',
      })
    ),
    []
  );
});

test("fails on a constructor parameter property in a published README and the ayme skill", () => {
  assert.deepEqual(
    checkDocs(
      fixture({
        "packages/lib/README.md": `# lib\n\n\`\`\`ts\nclass Page {\n  constructor(public page: Page) {}\n}\n\`\`\`\n\n## Usage\n`,
        "skills/ayme/references/model.md":
          "```ts\nclass LoginPage {\n  constructor(private readonly page: Page) {}\n}\n```\n",
      })
    ),
    [
      `packages/lib/README.md:5: ${PARAMETER_PROPERTY}`,
      `skills/ayme/references/model.md:3: ${PARAMETER_PROPERTY}`,
    ]
  );
});

test("separates parameter properties from defaults and parameter names", () => {
  assert.deepEqual(
    checkDocs(
      fixture({
        "docs/guide/start/page.md": `# A page\n\nWhat this page is for, in one sentence.\n\n\`\`\`ts\nclass App {\n  constructor(enabled = 1 < 2, private page: Page) {}\n  constructor(pattern = /[)]/, private root: Locator) {}\n  constructor(n = a / b, protected name: string) {}\n  constructor(page: Foo<Bar<Baz, Qux>>, override id: string) {}\n  constructor(cb: () => Foo<Bar, Baz>, readonly value: string) {}\n  constructor(n = ok ? 1 : x < y, private page: Page) {}\n  constructor(n = {} / 2, private page: Page) {}\n  constructor<T extends () => void>(readonly value: T) {}\n  constructor(cb: Map<() => void, readonly string[]>, page: Page) {}\n  constructor(value = new Map<string, readonly string[]>()) {}\n  constructor(readonly: boolean, override: string, readonly = true) {}\n}\n\`\`\`\n`,
      })
    ),
    [
      `docs/guide/start/page.md:7: ${PARAMETER_PROPERTY}`,
      `docs/guide/start/page.md:8: ${PARAMETER_PROPERTY}`,
      `docs/guide/start/page.md:9: ${PARAMETER_PROPERTY}`,
      `docs/guide/start/page.md:10: ${PARAMETER_PROPERTY}`,
      `docs/guide/start/page.md:11: ${PARAMETER_PROPERTY}`,
      `docs/guide/start/page.md:12: ${PARAMETER_PROPERTY}`,
      `docs/guide/start/page.md:13: ${PARAMETER_PROPERTY}`,
      `docs/guide/start/page.md:14: ${PARAMETER_PROPERTY}`,
    ]
  );
});

test("ignores a constructor parameter property outside the checked docs", () => {
  assert.deepEqual(
    checkDocs(
      fixture({
        "README.md":
          "# Readme\n\n```ts\nconstructor(readonly page: Page) {}\n```\n",
        "packages/internal/README.md":
          "# internal\n\n```ts\nconstructor(readonly page: Page) {}\n```\n",
        "skills/ayme-recorder/references/model.md":
          "```ts\nconstructor(readonly page: Page) {}\n```\n",
        "docs/notes.md":
          "# Notes\n\n```ts\nconstructor(readonly page: Page) {}\n```\n",
      })
    ),
    []
  );
});
