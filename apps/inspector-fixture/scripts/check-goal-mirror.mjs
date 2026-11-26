// Fails when a goal file (tests/goals/<stem>.goal.ts) drifts from its Page
// Object twin (tests/<stem>.e2e.ts). The arms of the study must be the same
// tests, told apart only by how they act on the panel:
// - every twin test that acts on the panel has a goal twin, under the same
//   describe and test titles, in the same order, made with the same
//   `testIn(...)` and inside the same loops;
// - both run the same assertion statements, compared as printed by
//   TypeScript, and the goal twin has one `agent.act` per panel action;
// - a goal file calls no action on the panel's Page Objects.
// Run from the fixture's package: `node scripts/check-goal-mirror.mjs`.
import console from "node:console";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { URL } from "node:url";
import ts from "typescript";

const tests = new URL("../tests/", import.meta.url).pathname;

/** The methods of the panel's Page Objects that act, as tests/e2e/pom/Inspector.ts names them. */
const ACTIONS = new Set([
  "check",
  "choose",
  "clear",
  "click",
  "collapse",
  "dragBy",
  "fill",
  "find",
  "hover",
  "open",
  "openArguments",
  "pickItem",
  "pickOnPage",
  "resizeBy",
  "run",
  "search",
  "selectOption",
  "set",
  "showAll",
  "showLens",
  "showSelection",
  "toggleFromTree",
  "togglePane",
  "tool",
  "uncheck",
  "undo",
]);

/** Pointer moves off an element, no step of the user's: every arm keeps the arm 2 line. */
const POINTER_MECHANICS = new Set([
  "inspector.header.title.hover()",
  "inspector.navigator.searchBox.hover()",
]);

const printer = ts.createPrinter({ removeComments: true });
const parse = (path) =>
  ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true
  );
const print = (node, file) =>
  printer.printNode(ts.EmitHint.Unspecified, node, file);
const isTitle = (node) =>
  node &&
  (ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateExpression(node));
const isFunction = (node) =>
  node && (ts.isArrowFunction(node) || ts.isFunctionExpression(node));

/** The leftmost identifier of a property-access or call chain. */
function rootOf(node) {
  while (true) {
    if (ts.isPropertyAccessExpression(node) || ts.isCallExpression(node))
      node = ts.isCallExpression(node) ? node.expression : node.expression;
    else if (ts.isParenthesizedExpression(node) || ts.isAwaitExpression(node))
      node = node.expression;
    else return node;
  }
}

/** The names bound from the panel: `inspector`, and what is read off it. */
function panelNames(file) {
  const names = new Set(["inspector"]);
  // A helper's parameter typed as one of the panel's Page Objects.
  const pomTypes = new Set();
  for (const statement of file.statements)
    if (
      ts.isImportDeclaration(statement) &&
      /pom\/Inspector"$/.test(statement.moduleSpecifier.getText(file)) &&
      statement.importClause?.namedBindings
    )
      for (const element of statement.importClause.namedBindings.elements)
        pomTypes.add(element.name.text);
  const declarations = [];
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.initializer)
      declarations.push(node);
    if (
      ts.isParameter(node) &&
      ts.isIdentifier(node.name) &&
      node.type &&
      pomTypes.has(node.type.getText(file))
    )
      names.add(node.name.text);
    ts.forEachChild(node, visit);
  };
  visit(file);
  const bound = (name) =>
    ts.isIdentifier(name)
      ? [name.text]
      : name.elements.flatMap((element) => bound(element.name));
  for (let grown = true; grown;) {
    grown = false;
    for (const declaration of declarations) {
      if (!mentionsPanel(declaration.initializer, names, file)) continue;
      for (const name of bound(declaration.name))
        if (!names.has(name)) grown = names.add(name);
    }
  }
  return names;
}

function mentionsPanel(node, names, file) {
  let found = false;
  const visit = (child) => {
    if (found) return;
    if (ts.isIdentifier(child) && names.has(child.text)) found = true;
    else ts.forEachChild(child, visit);
  };
  visit(node);
  return found || /\.inspector\b/.test(node.getText(file));
}

/** The panel actions called under `node`, by their call. */
function panelActions(node, names, file) {
  const calls = [];
  const visit = (child) => {
    if (
      ts.isCallExpression(child) &&
      ts.isPropertyAccessExpression(child.expression) &&
      ACTIONS.has(child.expression.name.text) &&
      !POINTER_MECHANICS.has(child.getText(file))
    ) {
      const receiver = child.expression.expression;
      const root = rootOf(receiver);
      // `tool` acts on the Inspector (it opens a tool's card); a view's
      // `tool` only finds a slot.
      const reader =
        child.expression.name.text === "tool" &&
        !/(^|\.)inspector$/.test(
          receiver.getText(file).replace(/^\(?await /, "")
        );
      if (
        !reader &&
        ((ts.isIdentifier(root) && names.has(root.text)) ||
          /\binspector\b/.test(receiver.getText(file)))
      )
        calls.push(child);
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return calls;
}

/** The `agent.act` calls under `node`. */
function goals(node, file) {
  const calls = [];
  const visit = (child) => {
    if (
      ts.isCallExpression(child) &&
      child.expression.getText(file) === "agent.act"
    )
      calls.push(child);
    ts.forEachChild(child, visit);
  };
  visit(node);
  return calls;
}

/** A statement that waits for a locator: `await (await x.front()).waitFor()`. */
function isWaitFor(statement) {
  let call = statement.expression;
  if (ts.isAwaitExpression(call)) call = call.expression;
  return (
    ts.isCallExpression(call) &&
    ts.isPropertyAccessExpression(call.expression) &&
    call.expression.name.text === "waitFor"
  );
}

/** The statements that assert: a locator's `waitFor`, or a call chain that starts at `expect`. */
function assertions(node, file) {
  const found = [];
  const visit = (child) => {
    if (ts.isExpressionStatement(child)) {
      const root = rootOf(child.expression);
      if ((ts.isIdentifier(root) && root.text === "expect") || isWaitFor(child))
        found.push(child);
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return found.map((statement) => ({
    statement,
    text: print(statement, file),
  }));
}

/**
 * Whether an assertion is one e2e's cache counts: a matcher on a locator,
 * which the suites hand to `expect` as `await x.front()`, or on the
 * browser. `expect.poll` and `expect` on a read value do not count.
 */
function countsForTheCache(statement, file) {
  if (isWaitFor(statement)) return true;
  const root = rootOf(statement.expression);
  const call = root.parent;
  if (!ts.isCallExpression(call) || !call.arguments[0]) return false;
  const subject = call.arguments[0].getText(file);
  return /\.front\(\)$/.test(subject) || subject === "browser";
}

/** Every test of a file, with what places it: describes, loops and its `testIn`. */
function testsOf(file) {
  const found = [];
  const declarations = new Map();
  const visit = (node, describes, loops) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name))
      declarations.set(node.name.text, node.initializer);
    if (ts.isForOfStatement(node)) {
      const header = `for (${node.initializer.getText(file)} of ${node.expression.getText(file)})`;
      return ts.forEachChild(node, (child) =>
        visit(child, describes, [...loops, header])
      );
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const [title, ...rest] = node.arguments;
      const body = rest.at(-1);
      if (isTitle(title) && isFunction(body)) {
        const name = node.expression.text;
        const titleText = title.getText(file);
        if (name === "describe") {
          const options = rest.slice(0, -1).map((arg) => arg.getText(file));
          return visit(
            body.body,
            [...describes, [titleText, ...options].join(", ")],
            loops
          );
        }
        const made = declarations.get(name);
        found.push({
          key: [...loops, ...describes, titleText].join(" > "),
          via: made ? `${name} = ${made.getText(file)}` : name,
          body,
        });
        return;
      }
    }
    ts.forEachChild(node, (child) => visit(child, describes, loops));
  };
  visit(file, [], []);
  return found;
}

/** Module-level helpers and the count of `count` they hold, for calls in a test. */
function helperCounts(file, count) {
  const helpers = new Map();
  for (const statement of file.statements)
    if (ts.isFunctionDeclaration(statement) && statement.name)
      helpers.set(statement.name.text, count(statement).length);
  return (node) => {
    let total = 0;
    const visit = (child) => {
      if (ts.isCallExpression(child) && ts.isIdentifier(child.expression))
        total += helpers.get(child.expression.text) ?? 0;
      ts.forEachChild(child, visit);
    };
    visit(node);
    return total;
  };
}

const problems = [];
const leftOut = [];
const goalFiles = readdirSync(join(tests, "goals")).filter((name) =>
  name.endsWith(".goal.ts")
);
const stems = new Set([
  ...goalFiles.map((name) => name.replace(/\.goal\.ts$/, "")),
  ...readdirSync(tests)
    .filter((name) => name.endsWith(".e2e.ts"))
    .map((name) => name.replace(/\.e2e\.ts$/, "")),
]);

for (const stem of [...stems].sort()) {
  const twinPath = join(tests, `${stem}.e2e.ts`);
  const goalPath = join(tests, "goals", `${stem}.goal.ts`);
  let twin, goal;
  try {
    twin = parse(twinPath);
  } catch {
    problems.push(`${stem}.goal.ts has no twin ${stem}.e2e.ts`);
    continue;
  }
  const twinNames = panelNames(twin);
  const twinHelpers = helperCounts(twin, (node) =>
    panelActions(node, twinNames, twin)
  );
  const inScope = testsOf(twin).filter((test) => {
    const acts =
      panelActions(test.body, twinNames, twin).length + twinHelpers(test.body);
    if (acts === 0) leftOut.push(`${stem}: ${test.key}`);
    return acts > 0;
  });
  try {
    goal = parse(goalPath);
  } catch {
    if (inScope.length)
      problems.push(
        `${stem}.e2e.ts acts on the panel, and has no ${stem}.goal.ts`
      );
    continue;
  }
  const goalTests = testsOf(goal);
  const goalHelpers = helperCounts(goal, (node) => goals(node, goal));
  for (const call of panelActions(goal, panelNames(goal), goal))
    problems.push(
      `${stem}.goal.ts:${goal.getLineAndCharacterOfPosition(call.getStart()).line + 1} acts on the panel's Page Objects: ${call.getText(goal)}`
    );

  const keys = (list) => list.map(({ key, via }) => `${key}  [${via}]`);
  const want = keys(inScope).join("\n");
  const have = keys(goalTests).join("\n");
  if (want !== have) {
    problems.push(
      `${stem}: the tests differ.\n  twin (acting on the panel):\n    ${keys(inScope).join("\n    ")}\n  goal:\n    ${keys(goalTests).join("\n    ")}`
    );
    continue;
  }

  inScope.forEach((test, index) => {
    const twinTest = test.body;
    const goalTest = goalTests[index].body;
    const label = `${stem}: ${test.key}`;
    const actions =
      panelActions(twinTest, twinNames, twin).length + twinHelpers(twinTest);
    const acts = goals(goalTest, goal).length + goalHelpers(goalTest);
    if (actions !== acts)
      problems.push(`${label}: ${actions} panel actions, ${acts} goals`);
    // An assertion that itself acts (a poll that hovers) differs by design:
    // it is compared by count only.
    const split = (list, acting) => ({
      plain: list
        .filter((item) => !acting(item.statement))
        .map((item) => item.text),
      acting: list.filter((item) => acting(item.statement)).length,
    });
    const want = split(
      assertions(twinTest, twin),
      (node) => panelActions(node, twinNames, twin).length > 0
    );
    const have = split(
      assertions(goalTest, goal),
      (node) => goals(node, goal).length > 0
    );
    // e2e saves a goal's recording only once a later check of the kind it
    // counts passed (docs/cache.mdx, "When a recording is written"): a
    // matcher on a locator or the browser, or a locator's `waitFor`. Not
    // `expect.poll`, nor `expect` on a plain value.
    const lastGoal = Math.max(
      ...goals(goalTest, goal).map((call) => call.getStart())
    );
    // A helper the test defines counts where the test calls it.
    const checkingHelpers = new Set();
    const findHelpers = (node) => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        isFunction(node.initializer) &&
        assertions(node.initializer, goal).some(({ statement }) =>
          countsForTheCache(statement, goal)
        )
      )
        checkingHelpers.add(node.name.text);
      ts.forEachChild(node, findHelpers);
    };
    findHelpers(goalTest);
    let counting = assertions(goalTest, goal).some(
      ({ statement }) =>
        statement.getStart() > lastGoal && countsForTheCache(statement, goal)
    );
    const findCalls = (node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        checkingHelpers.has(node.expression.text) &&
        node.getStart() > lastGoal
      )
        counting = true;
      ts.forEachChild(node, findCalls);
    };
    findCalls(goalTest);
    if (Number.isFinite(lastGoal) && !counting)
      problems.push(
        `${label}: no check e2e counts follows its last goal, so its goals are never saved`
      );
    if (want.acting !== have.acting)
      problems.push(
        `${label}: ${want.acting} acting assertions, ${have.acting}`
      );
    const length = Math.max(want.plain.length, have.plain.length);
    for (let at = 0; at < length; at++)
      if (want.plain[at] !== have.plain[at]) {
        problems.push(
          `${label}: assertion ${at + 1} differs\n  twin: ${want.plain[at] ?? "(none)"}\n  goal: ${have.plain[at] ?? "(none)"}`
        );
        break;
      }
  });
}

console.log(`Left out, no action on the panel (${leftOut.length}):`);
for (const test of leftOut) console.log(`  ${test}`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}
console.log("\nThe goal files mirror their twins.");
