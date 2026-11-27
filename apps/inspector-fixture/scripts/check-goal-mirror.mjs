// Fails when a goal file (tests/goals/**/<name>.goal.ts) is more than its
// twin (tests/**/<name>.e2e.ts) with the panel actions turned into goals, so
// the study's arms stay the same tests. Both files are compared whole, as
// syntax trees (formatting and comments aside), and may differ only where:
// - imports differ;
// - a function's destructured fixtures drop names or add `agent`;
// - one twin statement that awaits something of the panel is, in the goal
//   file, one or more `await agent.act(...)` statements
//   (`(await inspector.tool(x)).run(y)` is two goals);
// - a declaration that awaits and starts nothing (by its types) is on one
//   side only, such as a run card a goal opened;
// - a twin test or function is left out, when it ends without
//   confirmGoalRecordings and acts on nothing of the panel.
// Besides, a goal file acts on nothing of the panel (outside
// POINTER_MECHANICS), and each of its tests ends with CONFIRM, so e2e saves
// its goals. "Of the panel" is what is read off `inspector`, by symbol,
// leaving out `inspector.tab`, the browser tab the panel is in.
// `node scripts/check-goal-mirror.mjs` checks the files, then that each of
// CASES, edits that slipped past an earlier check, is rejected.
import console from "node:console";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("..", import.meta.url));
const tests = join(root, "tests");

/** Pointer moves off an element, no step of the user's: every arm keeps the arm 2 line. */
const POINTER_MECHANICS = new Set([
  "inspector.header.title.hover()",
  "inspector.navigator.searchBox.hover()",
]);

const CONFIRM = "await confirmGoalRecordings(browser);";

const printer = ts.createPrinter({ removeComments: true });
const print = (node) =>
  printer.printNode(ts.EmitHint.Unspecified, node, node.getSourceFile());
const isFunction = (node) =>
  node && (ts.isArrowFunction(node) || ts.isFunctionExpression(node));
const isTitle = (node) =>
  node &&
  (ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateExpression(node));

/** The leftmost expression of an access or call chain. */
function rootOf(node) {
  while (
    ts.isPropertyAccessExpression(node) ||
    ts.isElementAccessExpression(node) ||
    ts.isCallExpression(node) ||
    ts.isParenthesizedExpression(node) ||
    ts.isAwaitExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isVoidExpression(node) ||
    ts.isAsExpression(node)
  )
    node = node.expression;
  return node;
}

/** The chain an expression calls through, without the calls' arguments: `a.b(x).c` for `await a.b(x).c(y)`. */
function calleeOf(node) {
  while (
    ts.isAwaitExpression(node) ||
    ts.isParenthesizedExpression(node) ||
    ts.isCallExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isVoidExpression(node)
  )
    node = node.expression;
  return node;
}

const isGoal = (statement) =>
  ts.isExpressionStatement(statement) &&
  ts.isAwaitExpression(statement.expression) &&
  ts.isCallExpression(statement.expression.expression) &&
  statement.expression.expression.expression.getText() === "agent.act";

/** A check: a chain from `expect`, a locator's `waitFor`, or CONFIRM. */
function isCheck(statement) {
  if (!ts.isExpressionStatement(statement)) return false;
  const start = rootOf(statement.expression);
  if (ts.isIdentifier(start) && start.text === "expect") return true;
  if (print(statement) === CONFIRM) return true;
  let call = statement.expression;
  if (ts.isAwaitExpression(call)) call = call.expression;
  return (
    ts.isCallExpression(call) &&
    ts.isPropertyAccessExpression(call.expression) &&
    call.expression.name.text === "waitFor"
  );
}

/** `describe("...", ..., () => {...})` as a statement: its title and body. */
function describeCall(statement) {
  if (!ts.isExpressionStatement(statement)) return undefined;
  const call = statement.expression;
  if (!ts.isCallExpression(call) || call.expression.getText() !== "describe")
    return undefined;
  const [title, ...rest] = call.arguments;
  return isTitle(title) && isFunction(rest.at(-1))
    ? { title: title.getText(), fn: rest.at(-1) }
    : undefined;
}

/** `test("...", async (...) => {...})` as a statement, by any name but `describe`. */
function testCall(statement) {
  if (!ts.isExpressionStatement(statement)) return undefined;
  const call = statement.expression;
  if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression))
    return undefined;
  const [title, ...rest] = call.arguments;
  if (!isTitle(title) || !isFunction(rest.at(-1))) return undefined;
  if (call.expression.text === "describe") return undefined;
  return { title: title.getText(), fn: rest.at(-1) };
}

/** A node's children, tokens included, without doc comments. */
const children = (node) =>
  node
    .getChildren()
    .filter(
      (child) =>
        child.kind !== ts.SyntaxKind.EndOfFileToken &&
        (child.kind < ts.SyntaxKind.FirstJSDocNode ||
          child.kind > ts.SyntaxKind.LastJSDocNode)
    );

const where = (node) => {
  const file = node.getSourceFile();
  const { line } = file.getLineAndCharacterOfPosition(node.getStart());
  return `${relative(tests, file.fileName)}:${line + 1}`;
};

/** Every path under `dir` that ends with `suffix`, as the runner's `**` glob finds them. */
function walk(dir, suffix) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path, suffix);
    return entry.name.endsWith(suffix) ? [path] : [];
  });
}

/** What the program says about one file's code. */
function analysis(checker, file) {
  const symbolOf = (node) => {
    const symbol = checker.getSymbolAtLocation(node);
    return symbol && symbol.flags & ts.SymbolFlags.Alias
      ? checker.getAliasedSymbol(symbol)
      : symbol;
  };

  // The symbols of the panel: `inspector` and what is read off it, but not
  // its tab; a function value starts nothing by being declared.
  const panel = new Set();
  const declarations = [];
  const visit = (node) => {
    if (ts.isBindingElement(node) && node.name.getText() === "inspector")
      panel.add(symbolOf(node.name));
    if (ts.isVariableDeclaration(node) && node.initializer)
      declarations.push(node);
    ts.forEachChild(node, visit);
  };
  visit(file);
  const ofPanel = (node) => {
    let found = false;
    const look = (child) => {
      if (found || isFunction(child)) return;
      if (
        ts.isPropertyAccessExpression(child) &&
        child.name.text === "tab" &&
        ofPanel(child.expression)
      )
        return;
      if (ts.isIdentifier(child) && panel.has(symbolOf(child))) found = true;
      else ts.forEachChild(child, look);
    };
    look(node);
    return found;
  };
  const names = (name) =>
    ts.isIdentifier(name)
      ? [name]
      : name.elements.flatMap((element) => names(element.name));
  for (let grown = true; grown;) {
    grown = false;
    for (const declaration of declarations)
      if (ofPanel(declaration.initializer))
        for (const name of names(declaration.name)) {
          const symbol = symbolOf(name);
          if (symbol && !panel.has(symbol)) grown = Boolean(panel.add(symbol));
        }
  }
  // Function parameters typed as one of the panel's Page Objects.
  const pom = (type) =>
    type
      .getSymbol()
      ?.declarations?.some((d) =>
        d.getSourceFile().fileName.endsWith("/e2e/pom/Inspector.ts")
      );
  const params = (node) => {
    if (ts.isParameter(node) && node.type && ts.isIdentifier(node.name))
      if (pom(checker.getTypeAtLocation(node))) panel.add(symbolOf(node.name));
    ts.forEachChild(node, params);
  };
  params(file);

  /** How many times `node` awaits a value of the panel: one goal each. */
  const awaitsPanel = (node) => {
    let count = 0;
    const look = (child) => {
      if (ts.isAwaitExpression(child) && ofPanel(calleeOf(child.expression)))
        count += 1;
      ts.forEachChild(child, look);
    };
    look(node);
    return count;
  };

  /** A declaration that awaits nothing and whose calls return no promise. */
  const startsNothing = (statement) => {
    if (!ts.isVariableStatement(statement)) return false;
    let starts = false;
    const look = (child) => {
      if (starts || isFunction(child)) return;
      if (ts.isAwaitExpression(child)) starts = true;
      else if (ts.isCallExpression(child)) {
        const type = checker.getTypeAtLocation(child);
        if (checker.getPromisedTypeOfPromise(type)) starts = true;
      }
      if (!starts) ts.forEachChild(child, look);
    };
    look(statement);
    return !starts;
  };

  /** Statements under `node` that act on the panel. */
  const panelActs = (node) => {
    const found = [];
    const look = (child) => {
      if (
        ts.isExpressionStatement(child) &&
        !isCheck(child) &&
        !POINTER_MECHANICS.has(
          print(child.expression).replace(/^await /, "")
        ) &&
        ofPanel(calleeOf(child.expression))
      )
        found.push(child);
      ts.forEachChild(child, look);
    };
    look(node);
    return found;
  };

  return { awaitsPanel, startsNothing, panelActs };
}

/** Compares one twin with its goal file. */
function compareFiles(checker, twin, goal, problems, notes) {
  const a2 = analysis(checker, twin);
  const g = analysis(checker, goal);
  const goalFunctions = new Set(
    goal.statements.filter(ts.isFunctionDeclaration).map((s) => s.name?.text)
  );

  function leaveOut(statement) {
    if (describeCall(statement)) {
      for (const inner of describeCall(statement).fn.body.statements)
        if (testCall(inner) || describeCall(inner)) leaveOut(inner);
        else if (
          print(inner) !== print(statement) &&
          !ts.isVariableStatement(inner)
        )
          problems.push(`${where(inner)}: no counterpart in the goal file`);
      return;
    }
    const test = testCall(statement);
    if (
      ts.isFunctionDeclaration(statement) &&
      goalFunctions.has(statement.name?.text)
    )
      return problems.push(
        `${where(statement)}: out of order in the goal file`
      );
    if (test && print(test.fn.body.statements?.at(-1) ?? test.fn) === CONFIRM)
      return problems.push(
        `${where(statement)}: ends with confirmGoalRecordings, and has no goal twin`
      );
    const acts = a2.panelActs(statement);
    if (acts.length)
      return problems.push(
        `${where(acts[0])}: acts on the panel, and has no goal twin`
      );
    if (test) notes.leftOut.push(`${where(statement)} ${test.title}`);
  }

  const counterpart = (x, y) => {
    if (!y || x.kind !== y.kind) return false;
    if (ts.isFunctionDeclaration(x)) return x.name?.text === y.name?.text;
    if (describeCall(x))
      return describeCall(y)?.title === describeCall(x).title;
    return testCall(y)?.title === testCall(x).title;
  };
  const leavable = (x) =>
    testCall(x) || describeCall(x) || ts.isFunctionDeclaration(x);
  const among = (node, list) =>
    list.some((other) => print(other) === print(node));

  function statements(a, b) {
    let i = 0;
    let j = 0;
    while (i < a.length || j < b.length) {
      const [x, y] = [a[i], b[j]];
      if (x && y && print(x) === print(y)) {
        i += 1;
        j += 1;
      } else if (x && y && isGoal(y) && a2.awaitsPanel(x) && !isCheck(x)) {
        // As many goals as `x` awaits the panel, with declarations that
        // start nothing among and after them.
        const goals = a2.awaitsPanel(x);
        const next = a[i + 1] && print(a[i + 1]);
        let k = j;
        let found = 0;
        while (k < b.length && print(b[k]) !== next) {
          if (isGoal(b[k]) && found < goals) found += 1;
          else if (!g.startsNothing(b[k])) break;
          k += 1;
        }
        if (found !== goals)
          problems.push(
            `${where(x)}: awaits the panel ${goals} times, and ${where(y)} has ${found} goals for it`
          );
        if (goals > 1) notes.split.push(`${where(x)}: ${goals} goals`);
        i += 1;
        j = k;
      } else if (x && a2.startsNothing(x) && !among(x, b.slice(j))) {
        notes.dropped.push(`${where(x)}: ${print(x)}`);
        i += 1;
      } else if (y && g.startsNothing(y) && !among(y, a.slice(i))) {
        notes.added.push(`${where(y)}: ${print(y)}`);
        j += 1;
      } else if (x && leavable(x) && !counterpart(x, y)) {
        leaveOut(x);
        i += 1;
      } else if (x && y) {
        compare(x, y);
        i += 1;
        j += 1;
      } else if (x) {
        problems.push(`${where(x)}: no counterpart in the goal file`);
        i += 1;
      } else {
        problems.push(`${where(y)}: no counterpart in the twin`);
        j += 1;
      }
    }
  }

  function compare(x, y) {
    // A lone statement, such as an `if`'s body without braces.
    if (
      ts.isStatement(x) &&
      isGoal(y) &&
      a2.awaitsPanel(x) === 1 &&
      !isCheck(x)
    )
      return;
    if (x.kind !== y.kind) {
      problems.push(`${where(y)}: differs from ${where(x)}`);
      return;
    }
    if (ts.isObjectBindingPattern(x) && ts.isParameter(x.parent)) {
      const kept = new Set(x.elements.map(print));
      for (const element of y.elements)
        if (!kept.has(print(element)) && print(element) !== "agent")
          problems.push(`${where(element)}: a fixture its twin does not take`);
      return;
    }
    if (ts.isBlock(x) || ts.isSourceFile(x)) {
      const own = (list) => [...list].filter((s) => !ts.isImportDeclaration(s));
      statements(own(x.statements), own(y.statements));
      return;
    }
    const [cx, cy] = [children(x), children(y)];
    if (cx.length === 0 && cy.length === 0) {
      if (x.getText() !== y.getText())
        problems.push(
          `${where(y)}: "${y.getText()}" where ${where(x)} has "${x.getText()}"`
        );
      return;
    }
    if (cx.length !== cy.length) {
      problems.push(`${where(y)}: differs from ${where(x)}`);
      return;
    }
    cx.forEach((child, index) => compare(child, cy[index]));
  }

  compare(twin, goal);

  for (const act of g.panelActs(goal))
    problems.push(`${where(act)}: acts on the panel's Page Objects`);
  const visit = (node) => {
    const test = ts.isStatement(node) && testCall(node);
    if (!test) return ts.forEachChild(node, visit);
    const last = test.fn.body.statements?.at(-1);
    if (!last || print(last) !== CONFIRM)
      problems.push(`${where(node)}: does not end with ${CONFIRM}`);
  };
  visit(goal);
}

/** Checks every goal file and twin, reading files through `read`. */
export function check(read = (path) => readFileSync(path, "utf8")) {
  const problems = [];
  const notes = { leftOut: [], split: [], dropped: [], added: [] };
  const goalDir = join(tests, "goals");
  const goalPaths = walk(goalDir, ".goal.ts");
  const twinPaths = walk(tests, ".e2e.ts").filter(
    (p) => !p.startsWith(goalDir)
  );

  const config = ts.getParsedCommandLineOfConfigFile(
    join(root, "tsconfig.json"),
    {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} }
  );
  const host = ts.createCompilerHost(config.options);
  const readFile = host.readFile;
  host.readFile = (path) =>
    path.startsWith(tests) && /\.(goal|e2e)\.ts$/.test(path)
      ? read(path)
      : readFile(path);
  host.getSourceFile = (path, version) => {
    const text = host.readFile(path);
    return text === undefined
      ? undefined
      : ts.createSourceFile(path, text, version, true);
  };
  const program = ts.createProgram(
    [...goalPaths, ...twinPaths],
    config.options,
    host
  );
  const checker = program.getTypeChecker();
  const source = (path) => program.getSourceFile(path);

  const unpaired = new Set(twinPaths);
  for (const goalPath of goalPaths) {
    const twinPath = join(
      tests,
      relative(goalDir, goalPath).replace(/\.goal\.ts$/, ".e2e.ts")
    );
    if (!unpaired.delete(twinPath)) {
      problems.push(
        `${relative(tests, goalPath)}: no twin ${relative(tests, twinPath)}`
      );
      continue;
    }
    compareFiles(checker, source(twinPath), source(goalPath), problems, notes);
  }
  for (const twinPath of unpaired) {
    const acts = analysis(checker, source(twinPath)).panelActs(
      source(twinPath)
    );
    if (acts.length)
      problems.push(
        `${where(acts[0])}: acts on the panel, and its file has no goal file`
      );
  }
  return { problems, notes };
}

/** Edits an earlier check let through, each to one file: every one must be rejected. */
const CASES = [
  {
    name: "an assertion wrapped in if (false)",
    file: "goals/inspector.goal.ts",
    from: "  ).toHaveCount(1);\n",
    to: "  );\n  if (false) expect(1).toBe(1);\n",
  },
  {
    name: "a hover expectation changed inside a poll",
    file: "goals/modelLens.goal.ts",
    from: '"dashed"',
    to: '"none"',
  },
  {
    name: "the placement loop restricted to inline",
    file: "goals/runs.goal.ts",
    from: "for (const placement of placements) {",
    to: 'for (const placement of placements.filter((p) => p === "inline")) {',
  },
  {
    name: "an action through an element access",
    file: "goals/stacking.goal.ts",
    from: CONFIRM,
    to: `await inspector["collapse"]();\n${CONFIRM}`,
  },
  {
    name: "an assertion changed in a helper outside the tests",
    file: "goals/refPicking.goal.ts",
    from: '.toBe("crosshair")',
    to: '.toBe("default")',
  },
];

function selfTest() {
  return CASES.flatMap(({ name, file, from, to }) => {
    const target = join(tests, file);
    const text = readFileSync(target, "utf8");
    if (!text.includes(from))
      return [`${name}: "${from}" is no longer in ${file}`];
    const edited = text.replace(from, to);
    const { problems } = check((path) =>
      path === target ? edited : readFileSync(path, "utf8")
    );
    return problems.length ? [] : [`${name}: not rejected`];
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { problems, notes } = check();
  const list = (title, items) => {
    console.log(`${title} (${items.length}):`);
    for (const item of items) console.log(`  ${item}`);
  };
  list("Twin tests left out, acting on nothing of the panel", notes.leftOut);
  list("Twin statements that are several goal-file statements", notes.split);
  list("Twin declarations the goal file does without", notes.dropped);
  list("Goal-file declarations the twin does without", notes.added);
  for (const failure of selfTest()) problems.push(`check case: ${failure}`);
  if (problems.length) {
    console.error(`\n${problems.length} problem(s):`);
    for (const problem of problems) console.error(`- ${problem}`);
    process.exit(1);
  }
  console.log(
    `\nThe goal files mirror their twins, and all ${CASES.length} check cases are rejected.`
  );
}
