import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { ESLint } from "eslint";
import tseslint from "typescript-eslint";
import {
  boundariesPlugin,
  horizontalBoundaries,
} from "./horizontal-boundaries.js";

// A package on disk, so the resolver finds what each import names.
const packageRoot = realpathSync(
  mkdtempSync(join(tmpdir(), "horizontal-boundaries-"))
);
after(() => rmSync(packageRoot, { recursive: true, force: true }));
const files = {
  "src/runs/domain/run.ts": "export const run = 1;\n",
  "src/runs/application/startRun.ts": "export const startRun = 1;\n",
  "src/runs/infrastructure/useRuns.ts": "export const useRuns = 1;\n",
  "src/runs/presentation/useRunList.ts": "export const useRunList = 1;\n",
  "src/runs/view/RunList.ts": "export const RunList = 1;\n",
  "src/runs/test-utils/aRun.ts": "export const aRun = 1;\n",
  "src/tools/view/ToolList.ts": "export const ToolList = 1;\n",
  "src/app/main.ts": "export const main = 1;\n",
};
for (const [path, text] of Object.entries(files)) {
  mkdirSync(dirname(join(packageRoot, path)), { recursive: true });
  writeFileSync(join(packageRoot, path), text);
}

const eslint = new ESLint({
  cwd: packageRoot,
  overrideConfigFile: true,
  overrideConfig: [
    { files: ["**/*.ts"], languageOptions: { parser: tseslint.parser } },
    ...horizontalBoundaries({ packageRoot, enforcedSlices: ["runs"] }),
    // A package's own slice policy on the helper's elements.
    {
      files: ["src/**/*.ts"],
      plugins: { slices: boundariesPlugin },
      rules: {
        "slices/dependencies": [
          "error",
          {
            default: "allow",
            checkAllOrigins: false,
            checkUnknownLocals: false,
            policies: [
              {
                from: { element: { captured: { slice: "*" } } },
                disallow: { to: { element: { captured: { slice: "app" } } } },
                message: "Nothing uses app.",
              },
            ],
          },
        ],
      },
    },
  ],
});

/** Whether the layer rule refuses `from` importing `specifier`. */
async function refused(from, specifier) {
  const [result] = await eslint.lintText(
    `import "${specifier}";\nexport {};\n`,
    { filePath: join(packageRoot, from) }
  );
  const messages = result.messages.filter((message) =>
    message.ruleId?.startsWith("horizontal-boundaries/")
  );
  assert.deepEqual(
    messages.filter((message) => !message.ruleId.endsWith("/dependencies")),
    [],
    "only the dependencies rule reports"
  );
  return messages.length > 0;
}

const allowed = {
  domain: ["domain"],
  application: ["application", "domain"],
  infrastructure: ["infrastructure", "application", "domain"],
  presentation: ["presentation", "view", "application", "domain"],
  view: ["view", "domain"],
  "test-utils": [
    "domain",
    "application",
    "infrastructure",
    "presentation",
    "view",
    "test-utils",
  ],
};
const target = {
  domain: "../domain/run",
  application: "../application/startRun",
  infrastructure: "../infrastructure/useRuns",
  presentation: "../presentation/useRunList",
  view: "../view/RunList",
  "test-utils": "../test-utils/aRun",
};

for (const [from, uses] of Object.entries(allowed))
  test(`${from} may use only ${uses.join(", ")}`, async () => {
    for (const [to, specifier] of Object.entries(target))
      assert.equal(
        await refused(`src/runs/${from}/file.ts`, specifier),
        !uses.includes(to),
        `${from} -> ${to}`
      );
  });

test("the rule holds across slices", async () => {
  assert.equal(
    await refused("src/runs/domain/file.ts", "../../tools/view/ToolList"),
    true
  );
});

test("test files may use any layer", async () => {
  assert.equal(
    await refused("src/runs/domain/run.test.ts", "../view/RunList"),
    false
  );
});

test("slices that are not enrolled are not checked", async () => {
  assert.equal(
    await refused(
      "src/tools/view/file.ts",
      "../../runs/infrastructure/useRuns"
    ),
    false
  );
});

test("a package's slice policy holds alongside the layer rule", async () => {
  const [result] = await eslint.lintText(
    'import "../../app/main";\nimport "../view/RunList";\nexport {};\n',
    { filePath: join(packageRoot, "src/runs/domain/file.test.ts") }
  );
  assert.deepEqual(
    result.messages.map((message) => message.ruleId),
    ["slices/dependencies"]
  );
  const [production] = await eslint.lintText(
    'import "../../app/main";\nimport "../view/RunList";\nexport {};\n',
    { filePath: join(packageRoot, "src/runs/domain/file.ts") }
  );
  assert.deepEqual(
    production.messages.map((message) => message.ruleId).sort(),
    ["horizontal-boundaries/dependencies", "slices/dependencies"]
  );
});

test("it needs literal slice names", () => {
  assert.throws(() =>
    horizontalBoundaries({ packageRoot, enforcedSlices: [] })
  );
  assert.throws(() =>
    horizontalBoundaries({ packageRoot, enforcedSlices: ["*"] })
  );
});
