import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { checkDocs } from "./check-docs.mjs";

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
    "packages/lib/README.md": `# lib\n\nSee [the guide](https://github.com/ayme-labs/ayme/blob/main/docs/guide/start/page.md), [the package](https://github.com/ayme-labs/ayme/tree/main/packages/lib) and [usage](#usage).\n\nIssue https://github.com/ayme-labs/ayme/issues/12 is fine.\n\n\`[not a link](gone.md) #12\` in code:\n\n\`\`\`sh\n#12 and [no link](gone.md)\n\`\`\`\n`,
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
