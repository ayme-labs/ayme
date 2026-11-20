import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, it } from "vitest";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The packages whose types a caller of the module at `entry` can reach: the
 * package of every declaration its exports lead to, through any number of
 * the package's own declarations. For a source file that includes what its
 * function bodies use; a declaration file has none.
 */
function reachablePackages(entry: string): string[] {
  const file = join(packageRoot, entry);
  const program = ts.createProgram([file], {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ES2024,
    types: ["node"],
    skipLibCheck: true,
    noEmit: true,
  });
  const checker = program.getTypeChecker();
  const packages = new Set<string>();
  const seen = new Set<ts.Node>();
  const visit = (symbol: ts.Symbol) => {
    const target =
      symbol.flags & ts.SymbolFlags.Alias
        ? checker.getAliasedSymbol(symbol)
        : symbol;
    const declarations = target.declarations ?? [];
    // A built-in such as `Error` is no package's type, though a package that
    // adds to it, as Effect does, also declares it.
    const builtIn = declarations.some((declaration) =>
      program.isSourceFileDefaultLibrary(declaration.getSourceFile())
    );
    for (const declaration of builtIn ? [] : declarations) {
      if (seen.has(declaration)) continue;
      seen.add(declaration);
      const source = declaration.getSourceFile();
      // The last one: pnpm nests a package's folder in its store's.
      const [, name] =
        /.*\/node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(source.fileName) ?? [];
      if (name) {
        packages.add(name);
        continue;
      }
      const walk = (node: ts.Node) => {
        if (ts.isIdentifier(node)) {
          const used = checker.getSymbolAtLocation(node);
          if (used) visit(used);
        }
        ts.forEachChild(node, walk);
      };
      walk(declaration);
    }
  };
  const module = checker.getSymbolAtLocation(program.getSourceFile(file)!)!;
  for (const exported of checker.getExportsOfModule(module)) visit(exported);
  return [...packages].filter((name) => name !== "@types/node").sort();
}

// TypeScript builds a program per check.
const slow = { timeout: 60_000 };

it(
  "the check finds an Effect type and a Playwright type where there is one",
  slow,
  () => {
    // The session also reaches what the timeline is written with.
    expect(reachablePackages("src/session/application/index.ts")).toEqual([
      "effect",
      "yaml",
      "zod",
    ]);
    // zod comes with core's wait for a Settled Page, which the adapter drives.
    expect(reachablePackages("src/playwright/infrastructure/index.ts")).toEqual(
      ["effect", "playwright-core", "zod"]
    );
  }
);

// The check reads the build: the declaration file is what a caller's
// TypeScript sees.
it(
  "no Effect type and no Playwright type is reachable from the front door",
  slow,
  () => {
    expect(reachablePackages("dist/index.d.mts")).toEqual([]);
  }
);

const SPECIFIER =
  /(?:import|export)\s*(?:[^"']*?\sfrom\s*)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

/** Every package the built file, and the chunks it imports, import from. */
function importsOf(file: string, seen = new Set<string>()): string[] {
  if (seen.has(file)) return [];
  seen.add(file);
  const specifiers = [
    ...readFileSync(join(packageRoot, "dist", file), "utf8").matchAll(
      SPECIFIER
    ),
  ].map((match) => (match[1] ?? match[2])!);
  return specifiers.flatMap((specifier) =>
    specifier.startsWith("./")
      ? importsOf(specifier.slice(2), seen)
      : [specifier]
  );
}

it("the built engine imports Effect, core, a YAML writer, the window's server and Node, and nothing of Playwright", () => {
  const packages = new Set(
    importsOf("index.mjs").filter((specifier) => !specifier.startsWith("node:"))
  );
  expect([...packages].sort()).toEqual([
    "@ayme-dev/core/structural-observation",
    "@trpc/server",
    "@trpc/server/adapters/ws",
    "effect",
    "ws",
    "yaml",
    "zod/mini",
  ]);
});
