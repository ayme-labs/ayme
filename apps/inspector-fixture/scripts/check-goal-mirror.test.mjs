// check-goal-mirror against goal-mirror-fixture/: the pair, one action to one
// goal, passes, and each edit below, made in memory, fails for its own reason.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, URL } from "node:url";

import { check, checkSpecs } from "./check-goal-mirror.mjs";

const root = fileURLToPath(new URL("goal-mirror-fixture", import.meta.url));
const twin = join(root, "tests", "pair.e2e.ts");
const goal = join(root, "tests", "goals", "pair.goal.ts");
const spec = join(root, "tests", "pair.spec.ts");

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

const open = 'await inspector.tool("add");';
const openGoal =
  'await agent.act("open the {tool} tool", { params: { tool: "add" } });';
const runGoal =
  'await agent.act("run it with {text}", { params: { text: "Milk" } });';
const assertion = 'expect(expected).toEqual(["Milk"]);';
const confirm = "await confirmGoalRecordings(browser);";
const both = (from, to) => [
  [twin, from, to],
  [goal, from, to],
];
const STATEMENT = /expected the twin's statement/;
const GOAL_FOR_NOTHING = /a goal stands only for a Page Object action/;
const ONE_GOAL = /one goal, `await agent.act/;
const FIXTURES = /the twin's fixtures, plus `agent`/;
const LAST = /its last statement must be await confirmGoalRecordings/;

const rejected = [
  [
    "a registrar differs",
    [[goal, 'testIn("inline")', 'testIn("external")']],
    STATEMENT,
  ],
  [
    "a test is skipped in one arm",
    [[goal, 'test("adds', 'test.skip("adds']],
    STATEMENT,
  ],
  [
    "a declaration's value differs",
    [[goal, '["Milk"];', '["Bread"];']],
    STATEMENT,
  ],
  [
    "an assertion differs",
    [[goal, assertion, 'expect(expected).toContain("Milk");']],
    STATEMENT,
  ],
  ["an assertion is dropped", [[goal, assertion, ""]], STATEMENT],
  [
    "a declaration hides an action in one arm",
    [
      [
        twin,
        assertion,
        `const collapsed = await inspector.collapse();\n  ${assertion}`,
      ],
      [goal, "{ browser, agent }", "{ browser, agent, inspector }"],
    ],
    STATEMENT,
  ],
  [
    "a test without an action is left out of the goal file",
    [
      [
        twin,
        confirm + "\n});",
        `${confirm}\n});\n\ntest("reads", async ({ browser }) => {\n  ${confirm}\n});`,
      ],
    ],
    /expected the twin's statement\n {2}twin: test\("reads"/,
  ],
  [
    "an action gains a condition",
    [[twin, open, `if (expected.length) ${open}`]],
    GOAL_FOR_NOTHING,
  ],
  [
    "an assertion shares a statement with an action",
    [
      [twin, open, open.replace(";", ", expect(1).toBe(1);")],
      [goal, "{ browser, agent }", "{ browser, agent, inspector }"],
    ],
    GOAL_FOR_NOTHING,
  ],
  [
    "an extra goal",
    [[goal, confirm, `await agent.act("collapse the panel");\n  ${confirm}`]],
    GOAL_FOR_NOTHING,
  ],
  [
    "an action split into two goals",
    [[goal, runGoal, `${runGoal}\n  await agent.act("run it again");`]],
    GOAL_FOR_NOTHING,
  ],
  [
    "two actions folded into one goal",
    [
      [
        goal,
        `${openGoal}\n  ${runGoal}`,
        'await agent.act("open add and run it");',
      ],
    ],
    ONE_GOAL,
  ],
  [
    "an action kept as is in the goal file",
    [
      [goal, "{ browser, agent }", "{ browser, agent, inspector }"],
      [goal, openGoal, open],
    ],
    ONE_GOAL,
  ],
  [
    "an empty goal",
    [[goal, openGoal, 'await agent.act("");']],
    /one non-empty string literal/,
  ],
  [
    "a goal built at run time",
    [[goal, openGoal, "await agent.act(`open the ${expected[0]} tool`);"]],
    /one non-empty string literal/,
  ],
  [
    "a panel call inside a goal's arguments",
    [
      [goal, "{ browser, agent }", "{ browser, agent, inspector }"],
      [
        goal,
        '"open the {tool} tool"',
        '(await inspector.collapse(), "open the {tool} tool")',
      ],
    ],
    /one non-empty string literal/,
  ],
  [
    "a call in a goal's options",
    [[goal, '{ tool: "add" }', "{ tool: String(expected) }"]],
    /object literal of plain values/,
  ],
  [
    "an optional goal call",
    [[goal, "agent.act(", "agent.act?.("]],
    /is not `await agent.act/,
  ],
  [
    "a goal on an agent that is not its test's fixture",
    [
      ...both(
        "const test = ",
        "const agent = { act: async (goal: string, options?: object) => [goal, options] };\nconst test = "
      ),
      [goal, "{ browser, agent }", "{ browser }"],
    ],
    /is not on its test's own `agent` fixture/,
  ],
  [
    "a goal on a helper's own agent",
    [
      ...both(
        confirm,
        `const shared = async (agent: { act: (goal: string) => Promise<void> }) => agent;\n  ${confirm}`
      ),
      [
        goal,
        runGoal,
        'await (async (agent: { act: (goal: string) => Promise<void> }) => {\n    await agent.act("run it");\n  })(agent);',
      ],
    ],
    /expected one goal|is not on its test's own `agent` fixture/,
  ],
  [
    "a fixture the twin lacks",
    [[goal, "{ browser, agent }", "{ browser, agent, page }"]],
    FIXTURES,
  ],
  [
    "a fixture dropped though more than actions read it",
    [...both(assertion, `${assertion}\n  expect(inspector).toBeTruthy();`)],
    FIXTURES,
  ],
  [
    "a goal-file import its twin lacks",
    [[goal, "{ expect }", "{ test as expect }"]],
    /imports .* which its twin does not/,
  ],
  [
    "a dropped import more than actions read",
    [[goal, 'import { expect } from "e2e";', ""]],
    /lacks its twin's import/,
  ],
  [
    "the helper is not last",
    [...both(`${assertion}\n  ${confirm}`, `${confirm}\n  ${assertion}`)],
    LAST,
  ],
  [
    "a return before the helper",
    [...both(confirm, `return;\n  ${confirm}`)],
    LAST,
  ],
  [
    "the helper is not the fixtures' export",
    [
      ...both("confirmGoalRecordings, testIn", "testIn"),
      ...both(
        "const test = ",
        "const confirmGoalRecordings = async (browser: object) => browser;\nconst test = "
      ),
    ],
    /confirmGoalRecordings must be the one \.\.\/e2e\/fixtures exports/,
  ],
];

test("the pair, one action to one goal, mirrors", () => {
  assert.equal(problemsWith(), "");
});

for (const [name, edits, reason] of rejected)
  test(`rejects ${name}`, () => {
    assert.match(problemsWith(...edits), reason);
  });

test("fails with no goal files", () => {
  const empty = mkdtempSync(join(tmpdir(), "goal-mirror-"));
  try {
    assert.match(check({ root: empty }).problems.join("\n"), /no goal files/);
  } finally {
    rmSync(empty, { recursive: true });
  }
});

/** The spec problems with `edits` ([path, from, to]) made to the pair. */
function specProblemsWith(specOnly, ...edits) {
  const read = (path) =>
    edits.reduce(
      (text, [file, from, to]) =>
        file === path ? text.replace(from, to) : text,
      readFileSync(path, "utf8")
    );
  return checkSpecs({ root, read, specOnly }).join("\n");
}

test("the pair's Playwright spec holds its e2e twin's tests", () => {
  assert.equal(specProblemsWith(new Map()), "");
});

test("rejects a spec title its e2e twin lacks", () => {
  assert.match(
    specProblemsWith(new Map(), [spec, "adds an item", "adds a loaf"]),
    /pair\.spec\.ts has "adds a loaf", and pair\.e2e\.ts does not/
  );
});

test("rejects a SPEC_ONLY entry that names no spec", () => {
  assert.match(
    specProblemsWith(new Map([["gone.spec.ts", "a reason"]])),
    /SPEC_ONLY names no spec: gone\.spec\.ts/
  );
});
