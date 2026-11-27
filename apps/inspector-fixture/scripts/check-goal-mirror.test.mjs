// check-goal-mirror against goal-mirror-fixture/: the pair passes, and each
// edit below, made in memory to one side, fails for its own reason.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, URL } from "node:url";

import { check } from "./check-goal-mirror.mjs";

const root = fileURLToPath(new URL("goal-mirror-fixture", import.meta.url));
const twin = join(root, "tests", "pair.e2e.ts");
const goal = join(root, "tests", "goals", "pair.goal.ts");

/** The problems with `edits` ([path, from, to]) made to the pair. */
function problemsWith(...edits) {
  const read = (path) =>
    edits.reduce(
      (text, [file, from, to]) => {
        if (file !== path) return text;
        assert.ok(text.includes(from), `"${from}" is not in ${file}`);
        return text.replace(from, to);
      },
      readFileSync(path, "utf8")
    );
  return check({ root, read }).problems.join("\n");
}

const rejected = [
  [
    "a registrar differs",
    [goal, 'testIn("inline")', 'testIn("external")'],
    /expected the twin's statement/,
  ],
  [
    "a test is skipped on one side",
    [goal, 'test("adds', 'test.skip("adds'],
    /expected the twin's statement/,
  ],
  [
    "an action gains a condition",
    [
      twin,
      'await card.run("Milk");',
      'if (expected.length) await card.run("Milk");',
    ],
    /goals stand only for Page Object actions/,
  ],
  [
    "an assertion shares a statement with an action",
    [
      twin,
      'await card.run("Milk");',
      'await card.run("Milk"), expect(1).toBe(1);',
    ],
    /goals stand only for Page Object actions/,
  ],
  [
    "a declaration's value differs",
    [goal, 'const expected = ["Milk"];', 'const expected = ["Bread"];'],
    /expected the twin's statement/,
  ],
  [
    "a panel call inside a goal's arguments",
    [goal, "{ browser, agent }", "{ browser, agent, inspector }"],
    [
      goal,
      'agent.act("run it with Milk")',
      'agent.act((await inspector.collapse(), "run it with Milk"))',
    ],
    /goals stand only for Page Object actions|expected the twin's statement/,
  ],
  [
    "an extra goal outside an action run",
    [
      goal,
      "  await confirmGoalRecordings(browser);",
      '  await agent.act("collapse the panel");\n  await confirmGoalRecordings(browser);',
    ],
    /goals stand only for Page Object actions/,
  ],
  [
    "a Page Object action kept as is in the goal file",
    [goal, "{ browser, agent }", "{ browser, agent, inspector }"],
    [
      goal,
      '  await agent.act("open the add tool");\n  await agent.act("run it with Milk");',
      '  const card = await inspector.tool("add");\n  await card.run("Milk");',
    ],
    /a goal for this Page Object action/,
  ],
  [
    "a goal-side declaration that acts",
    [goal, "{ browser, agent }", "{ browser, agent, inspector }"],
    [
      goal,
      "  expect(expected)",
      "  const sneak = (() => void inspector.collapse())();\n  expect(expected)",
    ],
    /expected the twin's statement/,
  ],
  [
    "the helper is not last",
    [
      goal,
      '  expect(expected).toEqual(["Milk"]);\n  await confirmGoalRecordings(browser);',
      '  await confirmGoalRecordings(browser);\n  expect(expected).toEqual(["Milk"]);',
    ],
    /last statement must be await confirmGoalRecordings/,
  ],
  [
    "the helper is not the fixtures' export",
    ...[twin, goal].flatMap((file) => [
      [file, "confirmGoalRecordings, testIn", "testIn"],
      [
        file,
        "const test = ",
        "const confirmGoalRecordings = async (browser: object) => browser;\nconst test = ",
      ],
    ]),
    /last statement must be await confirmGoalRecordings/,
  ],
  [
    "an import does not resolve",
    [goal, '"../e2e/fixtures"', '"../e2e/fixturez"'],
    /does not resolve/,
  ],
  [
    "an imported name does not resolve",
    [
      goal,
      'import { expect } from "e2e";',
      'import { expectation as expect } from "e2e";',
    ],
    /does not resolve/,
  ],
].map(([name, ...rest]) => [name, rest.slice(0, -1), rest.at(-1)]);

test("the fixture pair mirrors", () => {
  assert.equal(problemsWith(), "");
});

for (const [name, edits, reason] of rejected)
  test(`rejects: ${name}`, () => {
    assert.match(problemsWith(...edits), reason);
  });

test("accepts a parenthesized goal", () => {
  assert.equal(
    problemsWith([
      goal,
      'await agent.act("run it with Milk")',
      'await (agent.act("run it with Milk"))',
    ]),
    ""
  );
});

test("accepts a renamed inspector fixture on both sides", () => {
  assert.equal(
    problemsWith(
      [twin, "{ browser, inspector }", "{ browser, inspector: panel }"],
      [twin, "inspector.tool", "panel.tool"],
      [goal, "{ browser, agent }", "{ browser, agent, inspector: panel }"]
    ),
    ""
  );
});

test("fails with no goal files", () => {
  const empty = mkdtempSync(join(tmpdir(), "goal-mirror-"));
  try {
    assert.match(check({ root: empty }).problems.join("\n"), /no goal files/);
  } finally {
    rmSync(empty, { recursive: true });
  }
});
