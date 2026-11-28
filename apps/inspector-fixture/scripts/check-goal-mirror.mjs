// Fails when a goal file (tests/goals/**/<name>.goal.ts) is not the same test
// as its twin (tests/**/<name>.e2e.ts). Each Page Object action statement of
// the twin, `await <one call>;` with nothing awaited before it, calling a
// method of a Page Object of tests/e2e/pom/Inspector.ts or of the locator
// (tests/e2e/tab.ts's On) one of them hands out, stands for exactly one goal statement,
// `await agent.act("<goal>", { <plain values> });`, at the same place.
// Everything else prints the same in both, down every block. The closed list
// of exceptions:
// - a test's fixtures gain `agent`, and may lose those only actions read;
// - the goal file's imports are its twin's, less those only actions, the
//   left-out tests below or their helpers read;
// - LEFT_OUT, the twin tests with no action to turn into a goal, have no
//   counterpart, nor have the twin's declarations only they use.
// Every goal-file test ends with `await confirmGoalRecordings(browser);`,
// imported from ../e2e/fixtures, and returns nowhere before it.
import console from "node:console";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

/** The twin tests (or describes) with no Page Object action, by file and title. */
export const LEFT_OUT = new Set([
  // An agent drives the panel over ayme MCP: the same code in every arm.
  "dogfood.e2e.ts › an agent drives the panel through the Inspector's Page Object Tools",
  "runs.e2e.ts › an agent's call over ayme MCP shows in Runs as the agent's",
  "mounting.e2e.ts › with the inspector option in demo mode",
  // They read, measure or drive the page and its runtime only.
  "dogfood.e2e.ts › the page state snapshot gives includes the panel",
  "inspector.e2e.ts › the page objects reach into the Inspector's closed shadow root",
  "inspector.e2e.ts › the panel follows the system theme",
  "inspector.e2e.ts › after its server stops",
  "inspector.e2e.ts › there is exactly one Inspector under React StrictMode",
  "inspector.e2e.ts › host CSS does not reach the panel",
  "inspector.e2e.ts › the panel's CSS does not reach the host",
  "inspector.e2e.ts › the legend counts what the page's runtime reports",
  "modelLens.e2e.ts › the model list shows every Page Object Model snapshot describes, including those not on the page",
  "mounting.e2e.ts › mounted by the session's inspector option",
]);

const CONFIRM = "await confirmGoalRecordings(browser);";
const PLAIN = new Set(
  [
    "ArrayLiteralExpression",
    "ElementAccessExpression",
    "FalseKeyword",
    "Identifier",
    "NoSubstitutionTemplateLiteral",
    "NonNullExpression",
    "NullKeyword",
    "NumericLiteral",
    "ObjectLiteralExpression",
    "PropertyAccessExpression",
    "PropertyAssignment",
    "ShorthandPropertyAssignment",
    "StringLiteral",
    "TrueKeyword",
  ].map((kind) => ts.SyntaxKind[kind])
);
const printer = ts.createPrinter({ removeComments: true });
const print = (node) =>
  node.kind < ts.SyntaxKind.FirstNode || node.kind === ts.SyntaxKind.SyntaxList
    ? node.getText()
    : printer.printNode(ts.EmitHint.Unspecified, node, node.getSourceFile());
const isFunction = (node) =>
  node && (ts.isArrowFunction(node) || ts.isFunctionExpression(node));
const has = (node, test) =>
  test(node) ||
  Boolean(ts.forEachChild(node, (c) => has(c, test) || undefined));
/** The identifiers of `node` named `name`. */
const uses = (node, name) => {
  const found = [];
  (function visit(n) {
    if (ts.isIdentifier(n) && n.text === name) found.push(n);
    ts.forEachChild(n, visit);
  })(node);
  return found;
};
const within = (node, outers) =>
  outers.some((o) => o.pos <= node.pos && node.end <= o.end);

/** Every file under `dir` ending with `suffix`, as the runner finds them: no dot directories, no symlinks. */
function walk(dir, suffix) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".") || entry.isSymbolicLink()) return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path, suffix);
    return entry.name.endsWith(suffix) ? [path] : [];
  });
}

/** A test or describe registration: its title and its function. */
function registration(statement) {
  if (!ts.isExpressionStatement(statement)) return undefined;
  const call = statement.expression;
  if (!ts.isCallExpression(call)) return undefined;
  // `test`, `describe`, a test made by testIn, and their `.skip` and `.only`.
  const callee =
    ts.isPropertyAccessExpression(call.expression) &&
    ["skip", "only"].includes(call.expression.name.text)
      ? call.expression.expression
      : call.expression;
  if (!ts.isIdentifier(callee)) return undefined;
  const [title] = call.arguments;
  const fn = call.arguments.at(-1);
  if (!title || !ts.isStringLiteralLike(title) || !isFunction(fn)) return;
  if (!ts.isBlock(fn.body)) return undefined;
  return { title: title.text, fn };
}

/** Whether `fn` is the function a test or describe registers. */
const isTestFunction = (fn) =>
  isFunction(fn) &&
  ts.isCallExpression(fn.parent) &&
  registration(fn.parent.parent)?.fn === fn;
/** Whether `node` is inside a function nested in `outer`. */
const inInnerFunction = (node, outer) => {
  for (let n = node.parent; n && n !== outer; n = n.parent)
    if (ts.isFunctionLike(n)) return true;
  return false;
};
/** Whether `node` is the name a declaration binds. */
const isBinding = (node) =>
  (ts.isVariableDeclaration(node.parent) ||
    ts.isFunctionDeclaration(node.parent) ||
    ts.isClassDeclaration(node.parent) ||
    ts.isParameter(node.parent) ||
    ts.isBindingElement(node.parent)) &&
  node.parent.name === node;

/** Checks every goal file under `root`/tests against its twin. */
export function check({
  root = fileURLToPath(new URL("..", import.meta.url)),
  read = (path) => readFileSync(path, "utf8"),
} = {}) {
  const tests = join(root, "tests");
  const goalDir = join(tests, "goals");
  const pom = join(tests, "e2e", "pom", "Inspector.ts");
  const tab = join(tests, "e2e", "tab.ts");
  const problems = [];
  const leftOut = [];
  const named = new Set();
  const where = (node) => {
    const file = node.getSourceFile();
    const { line } = file.getLineAndCharacterOfPosition(node.getStart());
    return `${relative(tests, file.fileName)}:${line + 1}`;
  };

  const goalPaths = walk(goalDir, ".goal.ts");
  const twinPaths = walk(tests, ".e2e.ts").filter(
    (path) => !path.startsWith(goalDir + sep)
  );
  const twinOf = (goal) =>
    join(tests, relative(goalDir, goal).replace(/\.goal\.ts$/, ".e2e.ts"));
  for (const goal of goalPaths)
    if (!twinPaths.includes(twinOf(goal)))
      problems.push(
        `${relative(tests, goal)}: no twin at ${relative(tests, twinOf(goal))}`
      );
  if (goalPaths.length === 0) problems.push(`no goal files under ${goalDir}`);
  if (problems.length) return { problems, leftOut };

  const own = new Set([...goalPaths, ...twinPaths]);
  const config = ts.getParsedCommandLineOfConfigFile(
    join(root, "tsconfig.json"),
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (d) =>
        problems.push(ts.flattenDiagnosticMessageText(d.messageText, "\n")),
    }
  );
  const host = ts.createCompilerHost(config.options, true);
  const library = host.getSourceFile;
  host.getSourceFile = (path, version, ...rest) =>
    own.has(path)
      ? ts.createSourceFile(path, read(path), version, true)
      : library(path, version, ...rest);
  const program = ts.createProgram([...own], config.options, host);
  const checker = program.getTypeChecker();
  // Fail closed on what does not parse; the typecheck owns the rest.
  for (const path of own)
    for (const d of program.getSyntacticDiagnostics(
      program.getSourceFile(path)
    ))
      problems.push(
        `${relative(tests, path)}: ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`
      );
  if (problems.length) return { problems, leftOut };

  /** `await <one call to a Page Object method>;`, with nothing awaited before it. */
  const isAction = (statement) => {
    if (!ts.isExpressionStatement(statement)) return false;
    const awaited = statement.expression;
    if (!ts.isAwaitExpression(awaited)) return false;
    const call = awaited.expression;
    if (
      !ts.isCallExpression(call) ||
      !ts.isPropertyAccessExpression(call.expression)
    )
      return false;
    const receiver = call.expression.expression;
    if (has(receiver, ts.isAwaitExpression)) return false;
    const declared = (node, file, inClass) =>
      checker
        .getSymbolAtLocation(node)
        ?.declarations?.some(
          (d) =>
            d.getSourceFile().fileName === file &&
            (!inClass || d.parent.name?.text === inClass)
        );
    if (declared(call.expression.name, pom)) return true;
    return Boolean(
      declared(call.expression.name, tab, "On") &&
      has(
        receiver,
        (n) => ts.isPropertyAccessExpression(n) && declared(n.name, pom)
      )
    );
  };
  const hasAction = (node) =>
    has(node, (n) => ts.isStatement(n) && isAction(n));

  /** Why `statement` is not a goal on its test's `agent` fixture, or nothing. */
  const notAGoal = (statement) => {
    const awaited = ts.isExpressionStatement(statement) && statement.expression;
    const call = awaited && ts.isAwaitExpression(awaited) && awaited.expression;
    const callee = call && ts.isCallExpression(call) && call.expression;
    if (
      !callee ||
      call.questionDotToken ||
      !ts.isPropertyAccessExpression(callee) ||
      callee.questionDotToken ||
      callee.name.text !== "act" ||
      !ts.isIdentifier(callee.expression) ||
      callee.expression.text !== "agent"
    )
      return "is not `await agent.act(...)`";
    const [goal, options, ...more] = call.arguments;
    if (
      !goal ||
      !ts.isStringLiteralLike(goal) ||
      !goal.text.trim() ||
      more.length
    )
      return "takes a goal that is not one non-empty string literal";
    if (options && !(ts.isObjectLiteralExpression(options) && plain(options)))
      return "takes options that are not an object literal of plain values";
    let fn = statement.parent;
    for (; fn && !isTestFunction(fn); fn = fn.parent)
      if (
        ts.isFunctionLike(fn) &&
        fn.parameters.some((p) => uses(p.name, "agent").length)
      )
        return "is not on its test's own `agent` fixture";
    const fixtures = fn?.parameters[0]?.name;
    const own =
      fixtures &&
      ts.isObjectBindingPattern(fixtures) &&
      fixtures.elements.some(
        (e) => !e.propertyName && !e.initializer && e.name.getText() === "agent"
      );
    return own ? undefined : "is not on its test's own `agent` fixture";
  };
  /** Literals, names, member reads, and object or array literals of them. */
  const plain = (node) =>
    PLAIN.has(node.kind) &&
    !ts.forEachChild(node, (child) => (plain(child) ? undefined : true));

  function compareFiles(twin, goal) {
    let failed = false;
    const fail = (x, y, expected) => {
      if (failed) return;
      failed = true;
      const show = (node) =>
        node ? print(node).split("\n").slice(0, 3).join("\n    ") : "(nothing)";
      problems.push(
        `${y ? where(y) : relative(tests, goal.fileName)} differs from ${x ? where(x) : relative(tests, twin.fileName)}: expected ${expected}\n  twin: ${show(x)}\n  goal: ${show(y)}`
      );
    };
    const actions = [];
    (function visit(n) {
      if (ts.isStatement(n) && isAction(n)) actions.push(n);
      else ts.forEachChild(n, visit);
    })(twin);
    const file = relative(tests, twin.fileName);
    const skipped = [];
    (function visit(n) {
      const r = ts.isStatement(n) && registration(n);
      if (r && LEFT_OUT.has(`${file} › ${r.title}`)) {
        skipped.push(n);
        named.add(`${file} › ${r.title}`);
        leftOut.push(`${where(n)} ${r.title}`);
        if (hasAction(n))
          fail(n, undefined, "no Page Object action in a LEFT_OUT test");
      } else ts.forEachChild(n, visit);
    })(twin);
    // Declarations, at any depth, used only by left-out tests and each other.
    const declarations = [];
    (function visit(n) {
      if (ts.isVariableStatement(n) || ts.isFunctionDeclaration(n))
        declarations.push(n);
      ts.forEachChild(n, visit);
    })(twin);
    const namesOf = (s) =>
      ts.isFunctionDeclaration(s)
        ? [s.name.text]
        : s.declarationList.declarations.flatMap(function bound(d) {
            return ts.isIdentifier(d.name)
              ? [d.name.text]
              : d.name.elements.flatMap(bound);
          });
    const unused = new Set();
    for (let grown = true; grown;) {
      grown = false;
      for (const s of declarations)
        if (
          !unused.has(s) &&
          namesOf(s).every((name) =>
            uses(twin, name).every((u) => within(u, [s, ...skipped, ...unused]))
          ) &&
          namesOf(s).some((name) =>
            uses(twin, name).some((u) => !within(u, [s]))
          )
        )
          grown = Boolean(unused.add(s));
    }
    /** Whether the twin reads `name` in `scope`, and only in actions and left-out code. */
    const onlyActions = (name, scope) => {
      const reads = uses(scope, name).filter(
        (u) =>
          !isBinding(u) &&
          !ts.isImportSpecifier(u.parent) &&
          !ts.isImportClause(u.parent)
      );
      return (
        reads.length > 0 &&
        reads.every((u) => within(u, [...actions, ...skipped, ...unused]))
      );
    };

    function list(a, b) {
      a = a.filter((s) => !ts.isImportDeclaration(s) && !skipped.includes(s));
      b = b.filter((s) => !ts.isImportDeclaration(s));
      let j = 0;
      for (const x of a) {
        if (failed) return;
        const y = b[j];
        if (unused.has(x) && !(y && print(x) === print(y))) continue;
        if (!y) return fail(x, undefined, "the twin's statement");
        compare(x, y);
        j += 1;
      }
      if (j < b.length) fail(undefined, b[j], "nothing: the twin ends here");
    }

    function compare(x, y) {
      if (failed) return;
      if (ts.isStatement(x) && isAction(x)) {
        const why = notAGoal(y);
        return why
          ? fail(
              x,
              y,
              `one goal, \`await agent.act("<goal>", { <plain values> });\`, for this action; the goal ${why}`
            )
          : undefined;
      }
      if (print(x) === print(y) && !hasAction(x)) return;
      if (ts.isBlock(x) || ts.isSourceFile(x) || ts.isModuleBlock(x)) {
        if (x.kind !== y.kind) return fail(x, y, "the twin's statement");
        return list([...x.statements], [...y.statements]);
      }
      const fn = ts.isParameter(x.parent) && x.parent.parent;
      if (
        fn &&
        isTestFunction(fn) &&
        fn.parameters[0] === x.parent &&
        ts.isObjectBindingPattern(x) &&
        ts.isObjectBindingPattern(y)
      ) {
        const twinNames = x.elements.map(print);
        const goalNames = y.elements.map(print).filter((n) => n !== "agent");
        const kept = twinNames.filter((n) => goalNames.includes(n));
        const dropped = x.elements.filter((e) => !goalNames.includes(print(e)));
        if (
          kept.join() !== goalNames.join() ||
          twinNames.includes("agent") ||
          [...x.elements, ...y.elements].some(
            (e) => e.initializer || e.dotDotDotToken
          ) ||
          dropped.some(
            (e) =>
              !ts.isIdentifier(e.name) || !onlyActions(e.name.text, fn.body)
          )
        )
          return fail(
            x,
            y,
            "the twin's fixtures, plus `agent`, less those only actions read"
          );
        return;
      }
      const [cx, cy] = [x, y].map((n) =>
        n.getChildren().filter((c) => !ts.isJSDoc(c))
      );
      if (
        x.kind !== y.kind ||
        cx.length !== cy.length ||
        (cx.length === 0 && x.getText() !== y.getText())
      ) {
        let [sx, sy] = [x, y];
        while (sx.parent && !ts.isStatement(sx)) sx = sx.parent;
        while (sy.parent && !ts.isStatement(sy)) sy = sy.parent;
        if (ts.isStatement(sy) && !notAGoal(sy))
          return fail(
            sx,
            sy,
            "the twin's statement: a goal stands only for a Page Object action"
          );
        return fail(sx, sy, "the twin's statement");
      }
      cx.forEach((child, index) => compare(child, cy[index]));
    }

    // Imports: the twin's, less those only actions or left-out code read.
    const imports = (file) =>
      file.statements.filter(ts.isImportDeclaration).flatMap((s) => {
        const spec = s.moduleSpecifier.text;
        const from = spec.startsWith(".")
          ? resolve(dirname(file.fileName), spec)
          : spec;
        const c = s.importClause;
        if (!c) return [{ key: `${from} (for its effects)` }];
        const n = c.namedBindings;
        return [
          ...(c.name ? [[`default as ${c.name.text}`, c.name]] : []),
          ...(n && ts.isNamespaceImport(n)
            ? [[`* as ${n.name.text}`, n.name]]
            : []),
          ...(n?.elements ?? []).map((e) => [print(e), e.name]),
        ].map(([what, id]) => ({
          key: `${c.isTypeOnly ? "type " : ""}${from} ${what}`,
          name: id.text,
        }));
      });
    const goalKeys = new Set(imports(goal).map((i) => i.key));
    const twinKeys = new Set(imports(twin).map((i) => i.key));
    for (const { key } of imports(goal))
      if (!twinKeys.has(key))
        problems.push(
          `${relative(tests, goal.fileName)}: imports ${key}, which its twin does not`
        );
    for (const { key, name } of imports(twin))
      if (!goalKeys.has(key) && !(name && onlyActions(name, twin)))
        problems.push(
          `${relative(tests, goal.fileName)}: lacks its twin's import ${key}, which more than actions read`
        );

    compare(twin, goal);
    if (failed) return;
    // Every goal-file test ends with the fixtures' confirmGoalRecordings.
    (function visit(node) {
      const test = ts.isStatement(node) && registration(node);
      if (!test) return ts.forEachChild(node, visit);
      const body = test.fn.body.statements;
      if (body.some(registration)) return ts.forEachChild(test.fn.body, visit);
      const returns = has(
        test.fn.body,
        (n) => ts.isReturnStatement(n) && !inInnerFunction(n, test.fn)
      );
      if (!body.length || print(body.at(-1)) !== CONFIRM || returns)
        problems.push(
          `${where(node)}: its last statement must be ${CONFIRM}, with no return before it`
        );
    })(goal);
    const fixtures = join(tests, "e2e", "fixtures");
    const imported = imports(goal).some(
      (i) => i.key === `${fixtures} confirmGoalRecordings`
    );
    if (!imported || uses(goal, "confirmGoalRecordings").some(isBinding))
      problems.push(
        `${relative(tests, goal.fileName)}: confirmGoalRecordings must be the one ../e2e/fixtures exports`
      );
  }

  for (const path of goalPaths)
    compareFiles(
      program.getSourceFile(twinOf(path)),
      program.getSourceFile(path)
    );
  for (const path of twinPaths.filter(
    (p) => !goalPaths.map(twinOf).includes(p)
  ))
    if (hasAction(program.getSourceFile(path)))
      problems.push(
        `${relative(tests, path)}: has Page Object actions, and no goal file`
      );
  for (const name of LEFT_OUT)
    if (
      twinPaths.some((p) => name.startsWith(`${relative(tests, p)} ›`)) &&
      !named.has(name)
    )
      problems.push(`LEFT_OUT names no test: ${name}`);
  return { problems, leftOut };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { problems, leftOut } = check();
  console.log(`Twin tests left out, LEFT_OUT (${leftOut.length}):`);
  for (const item of leftOut) console.log(`  ${item}`);
  if (problems.length) {
    console.error(`\n${problems.length} problem(s):`);
    for (const problem of problems) console.error(`- ${problem}`);
    process.exit(1);
  }
  console.log("\nThe goal files mirror their twins.");
}
