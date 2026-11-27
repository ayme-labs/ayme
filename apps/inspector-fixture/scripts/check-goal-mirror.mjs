// Fails when a goal file (tests/goals/**/<name>.goal.ts) is not its twin
// (tests/**/<name>.e2e.ts) with each run of Page Object actions turned into a
// run of goals. Every statement must print the same as its twin's, compared
// down every block, except for this closed list:
// - a run of consecutive actions matches a run of consecutive goals. An
//   action is an expression statement that is one awaited call chain on the
//   panel; a goal is exactly `await agent.act(...)` on the test's own `agent`
//   fixture, with arguments that call and await nothing. A twin declaration
//   in the run whose value is a chain on the panel goes with it, when only
//   the run's actions use what it declares;
// - a test's fixtures may drop names and add `agent`;
// - the goal file imports a subset of what its twin imports;
// - a twin test with no Page Object action to turn into a goal has no
//   counterpart, nor do declarations that only such tests use.
// Every goal-file test ends with the fixtures' confirmGoalRecordings. The
// panel is a test's `inspector` fixture, a parameter typed with one of
// tests/e2e/pom/'s Page Objects, and what is declared as a chain on them.
import console from "node:console";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

const printer = ts.createPrinter({ removeComments: true });
// Tokens and syntax lists have no printed form: their text stands in.
const print = (node) =>
  node.kind === ts.SyntaxKind.SyntaxList || node.kind < ts.SyntaxKind.FirstNode
    ? node.getText()
    : printer.printNode(ts.EmitHint.Unspecified, node, node.getSourceFile());
const strip = (node) => {
  while (ts.isParenthesizedExpression(node)) node = node.expression;
  return node;
};
/** The names a declaration binds, through destructuring. */
const names = (name) =>
  ts.isIdentifier(name) ? [name] : name.elements.flatMap((e) => names(e.name));
const isFunction = (node) =>
  node && (ts.isArrowFunction(node) || ts.isFunctionExpression(node));

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

/** Files outside the pairs, parsed once per process: the program reuses them. */
const shared = new Map();
let previous;

/** Checks every goal file under `root`/tests against its twin. */
export function check({
  root = fileURLToPath(new URL("..", import.meta.url)),
  read = (path) => readFileSync(path, "utf8"),
} = {}) {
  const tests = join(root, "tests");
  const goalDir = join(tests, "goals");
  const problems = [];
  const notes = { leftOut: [], uneven: [] };
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
  if (problems.length) return { problems, notes };

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
  host.readFile = ((readFile) => (path) =>
    own.has(path) ? read(path) : readFile(path))(host.readFile);
  host.getSourceFile = (path, version, ...rest) => {
    if (own.has(path))
      return ts.createSourceFile(path, read(path), version, true);
    if (!shared.has(path)) shared.set(path, library(path, version, ...rest));
    return shared.get(path);
  };
  const program = ts.createProgram([...own], config.options, host, previous);
  previous = program;
  const checker = program.getTypeChecker();
  const symbolOf = (node) => {
    const symbol = checker.getSymbolAtLocation(node);
    return symbol && symbol.flags & ts.SymbolFlags.Alias
      ? checker.getAliasedSymbol(symbol)
      : symbol;
  };

  // Fail closed: a file that does not parse, or an import that does not
  // resolve, gives no symbols to compare by.
  for (const path of own) {
    const file = program.getSourceFile(path);
    for (const d of program.getSyntacticDiagnostics(file))
      problems.push(
        `${where(file)}: ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`
      );
    for (const statement of file.statements.filter(ts.isImportDeclaration)) {
      if (!checker.getSymbolAtLocation(statement.moduleSpecifier))
        problems.push(
          `${where(statement)}: ${statement.moduleSpecifier.getText()} does not resolve`
        );
      for (const element of statement.importClause?.namedBindings?.elements ??
        [])
        if (!symbolOf(element.name)?.declarations?.length)
          problems.push(
            `${where(element)}: ${element.getText()} does not resolve`
          );
    }
  }
  if (problems.length) return { problems, notes };

  const fixtures = join(tests, "e2e", "fixtures.ts");
  /** e2e's own `test` or `describe`, or a test made by the fixtures' `testIn`. */
  const isRegistrar = (node) => {
    const symbol = symbolOf(rootOf(node));
    const d = symbol?.declarations?.[0];
    if (!d) return false;
    if (d.getSourceFile().fileName.includes(`${sep}node_modules${sep}`))
      return symbol.name === "test" || symbol.name === "describe";
    const made =
      ts.isVariableDeclaration(d) && d.initializer && strip(d.initializer);
    const maker =
      made &&
      ts.isCallExpression(made) &&
      symbolOf(made.expression)?.declarations?.[0];
    return Boolean(
      maker &&
      maker.getSourceFile().fileName === fixtures &&
      maker.name?.text === "testIn"
    );
  };
  /** A registered test or describe: its function and its callee with its title. */
  const registration = (statement) => {
    if (!statement || !ts.isExpressionStatement(statement)) return undefined;
    const call = strip(statement.expression);
    if (!ts.isCallExpression(call) || !isRegistrar(call.expression))
      return undefined;
    const [title] = call.arguments;
    const fn = call.arguments.at(-1);
    if (!title || !isFunction(fn) || !ts.isBlock(fn.body)) return undefined;
    return { fn, head: `${print(call.expression)}(${print(title)})` };
  };

  /** The leftmost expression of a chain of accesses, calls and awaits. */
  const rootOf = (node) => {
    for (node = strip(node); ; node = strip(node.expression))
      if (
        !ts.isAwaitExpression(node) &&
        !ts.isNonNullExpression(node) &&
        !ts.isCallExpression(node) &&
        !ts.isPropertyAccessExpression(node) &&
        !ts.isElementAccessExpression(node)
      )
        return node;
  };
  /** Whether `node` runs anything: a call, an await or a function. */
  const runs = (node) =>
    ts.isCallExpression(node) ||
    ts.isAwaitExpression(node) ||
    isFunction(node) ||
    Boolean(ts.forEachChild(node, (child) => runs(child) || undefined));
  const inert = (nodes) => !nodes.some(runs);
  /** A chain of accesses and calls on one name, its calls given inert arguments. */
  const isChain = (node) => {
    node = strip(node);
    if (ts.isIdentifier(node)) return true;
    if (ts.isAwaitExpression(node) || ts.isNonNullExpression(node))
      return isChain(node.expression);
    if (ts.isPropertyAccessExpression(node)) return isChain(node.expression);
    if (ts.isElementAccessExpression(node))
      return inert([node.argumentExpression]) && isChain(node.expression);
    if (ts.isCallExpression(node))
      return inert([...node.arguments]) && isChain(node.expression);
    return false;
  };

  /** The panel's symbols in `file`. */
  function panelOf(file) {
    const panel = new Set();
    const pom = join(tests, "e2e", "pom", "Inspector.ts");
    const declarations = [];
    (function visit(node) {
      // A name whose type is one of the panel's Page Objects.
      const named =
        (ts.isParameter(node) ||
          ts.isBindingElement(node) ||
          ts.isVariableDeclaration(node)) &&
        ts.isIdentifier(node.name);
      const type = named && checker.getTypeAtLocation(node.name).getSymbol();
      if (type?.declarations?.some((d) => d.getSourceFile().fileName === pom))
        panel.add(symbolOf(node.name));
      if (ts.isVariableDeclaration(node) && node.initializer)
        declarations.push(node);
      ts.forEachChild(node, visit);
    })(file);
    for (let grown = true; grown;) {
      grown = false;
      for (const d of declarations)
        if (onPanel(d.initializer, panel))
          for (const name of names(d.name))
            if (!panel.has(symbolOf(name)))
              grown = Boolean(panel.add(symbolOf(name)));
    }
    return panel;
  }
  const onPanel = (node, panel) => {
    const start = rootOf(node);
    return (
      isChain(node) && ts.isIdentifier(start) && panel.has(symbolOf(start))
    );
  };

  /** The Page Object actions of `file`. */
  function actionsOf(file) {
    const panel = panelOf(file);
    const isAction = (statement) => {
      const call = awaited(statement);
      return Boolean(call && ts.isCallExpression(call) && onPanel(call, panel));
    };
    const hasAction = (node) => {
      let found = false;
      (function visit(child) {
        if (found) return;
        if (ts.isStatement(child) && isAction(child)) found = true;
        else ts.forEachChild(child, visit);
      })(node);
      return found;
    };
    return { panel, isAction, hasAction };
  }
  const awaited = (statement) =>
    ts.isExpressionStatement(statement) &&
    ts.isAwaitExpression(strip(statement.expression))
      ? strip(strip(statement.expression).expression)
      : undefined;

  function compareFiles(twin, goal) {
    const { panel, isAction, hasAction } = actionsOf(twin);
    const isGoal = (statement) => {
      const call = awaited(statement);
      if (!call || !ts.isCallExpression(call) || !inert([...call.arguments]))
        return false;
      const callee = call.expression;
      if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== "act")
        return false;
      const fixture = symbolOf(callee.expression)?.declarations?.[0];
      return Boolean(
        fixture &&
        ts.isBindingElement(fixture) &&
        (fixture.propertyName ?? fixture.name).getText() === "agent" &&
        ts.isParameter(fixture.parent.parent)
      );
    };
    const declared = (statement) =>
      ts.isVariableStatement(statement)
        ? statement.declarationList.declarations
        : ts.isFunctionDeclaration(statement)
          ? [statement]
          : [];
    /** Whether every use of what `statement` declares is inside one of `within`. */
    const usedOnlyIn = (statement, within) => {
      const symbols = new Set(
        declared(statement).flatMap((d) => names(d.name).map(symbolOf))
      );
      let outside = false;
      (function visit(node) {
        if (outside) return;
        if (
          ts.isIdentifier(node) &&
          symbols.has(symbolOf(node)) &&
          !declared(statement).some(
            (d) => d.name.pos <= node.pos && node.end <= d.name.end
          ) &&
          !within.some((w) => w.pos <= node.pos && node.end <= w.end)
        )
          outside = true;
        else ts.forEachChild(node, visit);
      })(twin);
      return !outside;
    };
    const omitted = [];
    const leftOut = [];
    let failed = false;
    const fail = (x, y, expected) => {
      failed = true;
      const show = (node) =>
        node ? print(node).split("\n").slice(0, 3).join("\n    ") : "(nothing)";
      problems.push(
        `${y ? where(y) : relative(tests, goal.fileName)} differs from ${x ? where(x) : relative(tests, twin.fileName)}: expected ${expected}\n  twin: ${show(x)}\n  goal: ${show(y)}`
      );
    };

    function list(a, b) {
      let i = 0;
      let j = 0;
      while (!failed && (i < a.length || j < b.length)) {
        const [x, y] = [a[i], b[j]];
        if (x && isAction(x) && !(y && isGoal(y))) {
          return fail(x, y, "a goal for this Page Object action");
        } else if (x && y && print(x) === print(y) && !hasAction(x)) {
          i += 1;
          j += 1;
        } else if (y && isGoal(y)) {
          let k = j;
          while (k < b.length && isGoal(b[k])) k += 1;
          const after = b[k] && print(b[k]);
          let m = i;
          while (
            m < a.length &&
            print(a[m]) !== after &&
            (isAction(a[m]) ||
              (ts.isVariableStatement(a[m]) &&
                a[m].declarationList.declarations.every(
                  (d) => d.initializer && onPanel(d.initializer, panel)
                )))
          )
            m += 1;
          const run = a.slice(i, m);
          const actions = run.filter(isAction);
          if (actions.length === 0)
            return fail(
              x,
              y,
              "the twin's statement; goals stand only for Page Object actions"
            );
          const stray = run.find((s) => !isAction(s) && !usedOnlyIn(s, run));
          if (stray)
            return fail(stray, y, "a declaration only the run's actions use");
          if (actions.length !== k - j)
            notes.uneven.push(
              `${where(run[0])}: ${actions.length} action(s), ${k - j} goal(s)`
            );
          i = m;
          j = k;
        } else if (
          x &&
          registration(x) &&
          !hasAction(x) &&
          registration(x).head !== (y && registration(y)?.head)
        ) {
          leftOut.push(x);
          notes.leftOut.push(`${where(x)} ${registration(x).head}`);
          i += 1;
        } else if (
          x &&
          declared(x).length &&
          !(
            y &&
            declared(y).length &&
            print(declared(x)[0].name) === print(declared(y)[0].name)
          )
        ) {
          omitted.push(x);
          i += 1;
        } else if (x && y) {
          compare(x, y);
          i += 1;
          j += 1;
        } else
          return fail(
            x,
            y,
            x ? "the twin's statement" : "nothing: the twin ends here"
          );
      }
    }

    function compare(x, y) {
      if (failed || (print(x) === print(y) && !hasAction(x))) return;
      if (ts.isStatement(x) && isAction(x) && isGoal(y)) return;
      if (x.kind !== y.kind) return fail(x, y, "the twin's statement");
      if (ts.isBlock(x) || ts.isSourceFile(x)) {
        const own = (s) =>
          [...s.statements].filter((n) => !ts.isImportDeclaration(n));
        return list(own(x), own(y));
      }
      const test = ts.isParameter(x.parent) && x.parent.parent.parent?.parent;
      if (ts.isObjectBindingPattern(x) && test && registration(test)) {
        const kept = new Set(x.elements.map(print));
        const extra = y.elements.find(
          (e) => !kept.has(print(e)) && print(e) !== "agent"
        );
        return extra
          ? fail(x, y, "the twin's fixtures, less some, plus `agent`")
          : undefined;
      }
      const [cx, cy] = [x, y].map((n) =>
        n
          .getChildren()
          .filter(
            (c) =>
              c.kind < ts.SyntaxKind.FirstJSDocNode ||
              c.kind > ts.SyntaxKind.LastJSDocNode
          )
      );
      if (
        cx.length !== cy.length ||
        (cx.length === 0 && x.getText() !== y.getText())
      ) {
        let [sx, sy] = [x, y];
        while (sx.parent && !ts.isStatement(sx)) sx = sx.parent;
        while (sy.parent && !ts.isStatement(sy)) sy = sy.parent;
        return fail(sx, sy, "the twin's statement");
      }
      cx.forEach((child, index) => compare(child, cy[index]));
    }

    // Imports: a subset of the twin's, by the file each resolves to.
    const imports = (file) =>
      new Set(
        file.statements.filter(ts.isImportDeclaration).flatMap((s) => {
          const from = checker.getSymbolAtLocation(s.moduleSpecifier)?.name;
          const clause = s.importClause;
          const named = clause?.namedBindings;
          return [
            ...(clause?.name ? [`${from} default as ${clause.name.text}`] : []),
            ...(named && ts.isNamespaceImport(named)
              ? [`${from} * as ${named.name.text}`]
              : []),
            ...(named?.elements ?? []).map((e) => `${from} ${print(e)}`),
          ];
        })
      );
    const twinImports = imports(twin);
    for (const name of imports(goal))
      if (!twinImports.has(name))
        problems.push(
          `${relative(tests, goal.fileName)}: imports ${name}, which its twin does not`
        );

    compare(twin, goal);
    for (const statement of omitted)
      if (!failed && !usedOnlyIn(statement, [...leftOut, ...omitted]))
        fail(
          statement,
          undefined,
          "this declaration in the goal file too: tests with a twin use it"
        );

    // Every goal-file test ends with the fixtures' confirmGoalRecordings.
    (function visit(node) {
      const test = ts.isStatement(node) && registration(node);
      if (!test) return ts.forEachChild(node, visit);
      if (test.fn.body.statements.some(registration))
        return ts.forEachChild(test.fn.body, visit);
      const last = test.fn.body.statements.at(-1);
      const call = last && awaited(last);
      const target =
        call &&
        ts.isCallExpression(call) &&
        symbolOf(call.expression)?.declarations?.[0];
      if (
        !target ||
        target.getSourceFile().fileName !== fixtures ||
        target.name?.text !== "confirmGoalRecordings"
      )
        problems.push(
          `${where(node)}: its last statement must be await confirmGoalRecordings(browser), imported from ../e2e/fixtures`
        );
    })(goal);
  }

  for (const path of goalPaths)
    compareFiles(
      program.getSourceFile(twinOf(path)),
      program.getSourceFile(path)
    );
  for (const path of twinPaths.filter(
    (p) => !goalPaths.map(twinOf).includes(p)
  ))
    if (
      actionsOf(program.getSourceFile(path)).hasAction(
        program.getSourceFile(path)
      )
    )
      problems.push(
        `${relative(tests, path)}: has Page Object actions, and no goal file`
      );
  return { problems, notes };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { problems, notes } = check();
  const show = (title, items) => {
    console.log(`${title} (${items.length}):`);
    for (const item of items) console.log(`  ${item}`);
  };
  show(
    "Twin tests left out: no Page Object action to turn into a goal",
    notes.leftOut
  );
  show("Action runs whose goal count differs", notes.uneven);
  if (problems.length) {
    console.error(`\n${problems.length} problem(s):`);
    for (const problem of problems) console.error(`- ${problem}`);
    process.exit(1);
  }
  console.log("\nThe goal files mirror their twins.");
}
