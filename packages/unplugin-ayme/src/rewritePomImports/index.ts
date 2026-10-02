import path from "node:path";

import ts from "typescript";

import { createPomProgram, type PomCompilerOptions } from "../pomProgram";

type Replacement = {
  start: number;
  end: number;
  text: string;
};

type ResolvedImport = {
  element: ts.ImportSpecifier;
  importedName: string;
  definingFile: ts.SourceFile;
};

/**
 * Removes only the Playwright runtime edges that are hidden behind an unused
 * branch of a relative local barrel imported by a POM.
 */
export function rewritePomImports(
  code: string,
  fileName: string,
  options: PomCompilerOptions = {},
  existingProgram?: ts.Program
) {
  const sourceFile = ts.createSourceFile(
    fileName,
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const candidates = sourceFile.statements.filter(
    (statement): statement is LocalNamedImport =>
      ts.isImportDeclaration(statement) && isNamedLocalImport(statement)
  );
  if (candidates.length === 0) return code;

  const program =
    existingProgram ??
    createPomProgram(path.resolve(fileName), options, {
      fallbackToUnconfigured: true,
    });
  const checker = program.getTypeChecker();
  const replacements = candidates.flatMap((declaration) => {
    const replacement = replacementFor(
      declaration,
      sourceFile,
      program,
      checker,
      path.resolve(fileName)
    );
    return replacement ? [replacement] : [];
  });

  return applyReplacements(code, replacements);
}

type LocalNamedImport = ts.ImportDeclaration & {
  importClause: ts.ImportClause & { namedBindings: ts.NamedImports };
  moduleSpecifier: ts.StringLiteral;
};

function isNamedLocalImport(
  declaration: ts.ImportDeclaration
): declaration is LocalNamedImport {
  const clause = declaration.importClause;
  return (
    clause?.namedBindings !== undefined &&
    ts.isNamedImports(clause.namedBindings) &&
    isRelativeSpecifier(declaration.moduleSpecifier)
  );
}

function replacementFor(
  declaration: LocalNamedImport,
  sourceFile: ts.SourceFile,
  program: ts.Program,
  checker: ts.TypeChecker,
  containingFileName: string
): Replacement | undefined {
  const clause = declaration.importClause;
  const namedBindings = clause.namedBindings;
  if (
    clause.name ||
    clause.isTypeOnly ||
    namedBindings.elements.every((element) => element.isTypeOnly) ||
    declaration.attributes?.elements.length
  )
    return undefined;

  const moduleFileName = resolveModuleFileName(
    declaration.moduleSpecifier.text,
    containingFileName,
    program
  );
  if (!moduleFileName) return undefined;

  const moduleSourceFile = program.getSourceFile(moduleFileName);
  const moduleSymbol = moduleSourceFile
    ? checker.getSymbolAtLocation(moduleSourceFile)
    : undefined;
  if (!moduleSourceFile || !moduleSymbol) return undefined;

  const exports = checker.getExportsOfModule(moduleSymbol);
  const exportsByName = new Map(exports.map((symbol) => [symbol.name, symbol]));
  const selected = namedBindings.elements.map((element) => {
    const importedName = element.propertyName?.text ?? element.name.text;
    const symbol = exportsByName.get(importedName);
    const resolvedSymbol = symbol ? aliasedSymbol(symbol, checker) : undefined;
    const definingFile = symbol
      ? definingSourceFile(symbol, checker)
      : undefined;
    return { element, importedName, symbol, resolvedSymbol, definingFile };
  });

  if (selected.some(({ symbol, definingFile }) => !symbol || !definingFile))
    return undefined;
  if (
    selected.some(
      ({ element, definingFile, importedName }) =>
        !element.isTypeOnly &&
        definingFile !== undefined &&
        hasPlaywrightRuntimeEdge(
          moduleSourceFile,
          program,
          checker,
          importedName
        )
    )
  ) {
    return undefined;
  }

  if (!hasPlaywrightRuntimeEdge(moduleSourceFile, program, checker)) {
    return undefined;
  }

  const groups = new Map<string, ResolvedImport[]>();
  for (const { element, definingFile, resolvedSymbol } of selected) {
    if (!definingFile) return undefined;
    if (!resolvedSymbol) return undefined;
    const key = path.resolve(definingFile.fileName);
    const group = groups.get(key) ?? [];
    group.push({
      element,
      importedName: resolvedSymbol.name,
      definingFile,
    });
    groups.set(key, group);
  }

  const quote = sourceFile.text.slice(
    declaration.moduleSpecifier.getStart(sourceFile),
    declaration.moduleSpecifier.end
  )[0];
  const rendered = [...groups.entries()]
    .map(([definingFileName, imports]) => {
      const definingFile = imports[0]?.definingFile;
      if (
        !definingFile ||
        path.resolve(definingFile.fileName) !== definingFileName
      )
        return undefined;
      const moduleSpecifier = relativeSpecifier(
        containingFileName,
        definingFile.fileName
      );
      return renderImport(
        clause,
        imports,
        moduleSpecifier,
        quote === "'" ? "'" : '"'
      );
    })
    .filter((text): text is string => text !== undefined)
    .join("\n");
  if (rendered === "") return undefined;

  return {
    start: declaration.getStart(sourceFile),
    end: declaration.end,
    text: rendered,
  };
}

function definingSourceFile(
  symbol: ts.Symbol,
  checker: ts.TypeChecker
): ts.SourceFile | undefined {
  const resolved = aliasedSymbol(symbol, checker);
  if (resolved.flags & ts.SymbolFlags.Module) return undefined;
  const files = [
    ...new Set(
      (resolved.declarations ?? []).map((declaration) =>
        declaration.getSourceFile()
      )
    ),
  ];
  return files.length === 1 ? files[0] : undefined;
}

function aliasedSymbol(symbol: ts.Symbol, checker: ts.TypeChecker) {
  return symbol.flags & ts.SymbolFlags.Alias
    ? checker.getAliasedSymbol(symbol)
    : symbol;
}

function importDeclarationUsesExport(
  sourceFile: ts.SourceFile,
  exportName: string,
  statement: ts.ImportDeclaration,
  checker: ts.TypeChecker,
  importedFile?: ts.SourceFile,
  program?: ts.Program
) {
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  const exportSymbol = moduleSymbol
    ? checker
        .getExportsOfModule(moduleSymbol)
        .find((symbol) => symbol.name === exportName)
    : undefined;
  const declarations = exportSymbol?.declarations ?? [];
  if (declarations.length === 0) return false;

  const clause = statement.importClause;
  const bindings = clause?.namedBindings;
  if (!bindings) {
    const binding = clause?.name
      ? checker.getSymbolAtLocation(clause.name)
      : undefined;
    return taintedImportReferencesExport(
      declarations,
      binding,
      importedFile,
      program,
      checker
    );
  }

  if (ts.isNamespaceImport(bindings)) {
    const binding = checker.getSymbolAtLocation(bindings.name);
    return taintedImportReferencesExport(
      declarations,
      binding,
      importedFile,
      program,
      checker
    );
  }

  return bindings.elements.some((element) => {
    if (element.isTypeOnly) return false;
    const binding = checker.getSymbolAtLocation(element.name);
    if (!binding) return false;
    const importedName = element.propertyName?.text ?? element.name.text;
    return taintedImportReferencesExport(
      declarations,
      binding,
      importedFile,
      program,
      checker,
      importedName
    );
  });
}

function taintedImportReferencesExport(
  declarations: readonly ts.Declaration[],
  binding: ts.Symbol | undefined,
  importedFile: ts.SourceFile | undefined,
  program: ts.Program | undefined,
  checker: ts.TypeChecker,
  importedName?: string
) {
  if (!binding) return false;
  const tainted =
    !importedFile || !program
      ? true
      : hasPlaywrightRuntimeEdge(importedFile, program, checker, importedName);
  return (
    tainted &&
    declarations.some((declaration) =>
      declarationReferences(declaration, binding, checker)
    )
  );
}

function declarationReferences(
  declaration: ts.Node,
  symbol: ts.Symbol,
  checker: ts.TypeChecker
) {
  let found = false;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (
      ts.isIdentifier(node) &&
      node !== declaration &&
      sameSymbol(checker.getSymbolAtLocation(node), symbol, checker)
    ) {
      found = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(declaration);
  return found;
}

function sameSymbol(
  left: ts.Symbol | undefined,
  right: ts.Symbol,
  checker: ts.TypeChecker
) {
  if (!left) return false;
  if (left === right) return true;
  if (
    !(left.flags & ts.SymbolFlags.Alias) ||
    !(right.flags & ts.SymbolFlags.Alias)
  )
    return false;
  const leftResolved = aliasedSymbol(left, checker);
  const rightResolved = aliasedSymbol(right, checker);
  return (
    left.name === right.name &&
    leftResolved.name === rightResolved.name &&
    declarationFiles(leftResolved).join("\n") ===
      declarationFiles(rightResolved).join("\n")
  );
}

function declarationFiles(symbol: ts.Symbol) {
  return [
    ...new Set(
      (symbol.declarations ?? []).map((declaration) =>
        path.resolve(declaration.getSourceFile().fileName)
      )
    ),
  ].sort();
}

function exportDeclarationExportsName(
  statement: ts.ExportDeclaration,
  exportName: string
) {
  if (!statement.exportClause) return exportName;
  if (!ts.isNamedExports(statement.exportClause)) return undefined;
  const element = statement.exportClause.elements.find(
    (candidate) => candidate.name.text === exportName
  );
  if (!element || element.isTypeOnly) return undefined;
  return element.propertyName?.text ?? element.name.text;
}

function hasPlaywrightRuntimeEdge(
  sourceFile: ts.SourceFile,
  program: ts.Program,
  checker: ts.TypeChecker,
  exportName?: string,
  visited = new Set<string>()
): boolean {
  const fileName = path.resolve(sourceFile.fileName);
  const key = exportName === undefined ? fileName : `${fileName}:${exportName}`;
  if (visited.has(key)) return false;
  visited.add(key);

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (
        isPlaywrightSpecifier(statement.moduleSpecifier) &&
        importDeclarationIsRuntime(statement)
      ) {
        if (
          exportName === undefined ||
          !statement.importClause ||
          importDeclarationUsesExport(
            sourceFile,
            exportName,
            statement,
            checker
          )
        ) {
          return true;
        }
      }
      if (
        isRelativeSpecifier(statement.moduleSpecifier) &&
        importDeclarationIsRuntime(statement)
      ) {
        const importedFile = moduleSourceFile(
          statement.moduleSpecifier.text,
          fileName,
          program
        );
        if (!importedFile) continue;
        if (exportName === undefined) {
          if (
            hasPlaywrightRuntimeEdge(
              importedFile,
              program,
              checker,
              undefined,
              visited
            )
          )
            return true;
        } else if (!statement.importClause) {
          if (hasPlaywrightRuntimeEdge(importedFile, program, checker))
            return true;
        } else if (
          importDeclarationUsesExport(
            sourceFile,
            exportName,
            statement,
            checker,
            importedFile,
            program
          )
        ) {
          return true;
        }
      }
    }

    if (ts.isExportDeclaration(statement)) {
      if (
        statement.moduleSpecifier &&
        isPlaywrightSpecifier(statement.moduleSpecifier) &&
        exportDeclarationIsRuntime(statement) &&
        (exportName === undefined ||
          exportDeclarationExportsName(statement, exportName) !== undefined)
      ) {
        return true;
      }
      if (
        statement.moduleSpecifier &&
        isRelativeSpecifier(statement.moduleSpecifier) &&
        exportDeclarationIsRuntime(statement)
      ) {
        const exportedFile = moduleSourceFile(
          statement.moduleSpecifier.text,
          fileName,
          program
        );
        if (!exportedFile) continue;
        if (exportName === undefined) {
          if (
            hasPlaywrightRuntimeEdge(
              exportedFile,
              program,
              checker,
              undefined,
              visited
            )
          )
            return true;
        } else {
          const targetName = exportDeclarationExportsName(
            statement,
            exportName
          );
          if (
            targetName &&
            hasPlaywrightRuntimeEdge(
              exportedFile,
              program,
              checker,
              targetName,
              visited
            )
          )
            return true;
        }
      }
    }
  }

  return false;
}

function importDeclarationIsRuntime(statement: ts.ImportDeclaration) {
  const clause = statement.importClause;
  if (!clause) return true;
  if (clause.isTypeOnly) return false;
  return !(
    clause.namedBindings &&
    ts.isNamedImports(clause.namedBindings) &&
    clause.namedBindings.elements.every((element) => element.isTypeOnly)
  );
}

function exportDeclarationIsRuntime(statement: ts.ExportDeclaration) {
  if (statement.isTypeOnly) return false;
  return !(
    statement.exportClause &&
    ts.isNamedExports(statement.exportClause) &&
    statement.exportClause.elements.every((element) => element.isTypeOnly)
  );
}

function moduleSourceFile(
  specifier: string,
  containingFileName: string,
  program: ts.Program
) {
  const resolved = resolveModuleFileName(
    specifier,
    containingFileName,
    program
  );
  return resolved ? program.getSourceFile(resolved) : undefined;
}

function resolveModuleFileName(
  specifier: string,
  containingFileName: string,
  program: ts.Program
) {
  const resolved = ts.resolveModuleName(
    specifier,
    containingFileName,
    program.getCompilerOptions(),
    ts.sys
  ).resolvedModule;
  return resolved ? path.resolve(resolved.resolvedFileName) : undefined;
}

function isRelativeSpecifier(node: ts.Expression): node is ts.StringLiteral {
  return ts.isStringLiteral(node) && node.text.startsWith(".");
}

function isPlaywrightSpecifier(node: ts.Expression): node is ts.StringLiteral {
  return (
    ts.isStringLiteral(node) &&
    (node.text === "playwright" || node.text === "@playwright/test")
  );
}

function relativeSpecifier(fromFileName: string, toFileName: string) {
  const relative = path
    .relative(path.dirname(fromFileName), toFileName)
    .replace(/\\/g, "/")
    .replace(/\.(?:d\.)?(?:mts|cts|ts|tsx|js|jsx)$/, "");
  const withoutIndex = relative.endsWith("/index")
    ? relative.slice(0, -"/index".length)
    : relative;
  return withoutIndex.startsWith(".") ? withoutIndex : `./${withoutIndex}`;
}

function renderImport(
  clause: ts.ImportClause,
  imports: ResolvedImport[],
  moduleSpecifier: string,
  quote: "'" | '"'
) {
  const bindings = imports
    .map(({ element, importedName }) => {
      const alias =
        importedName === element.name.text
          ? importedName
          : `${importedName} as ${element.name.text}`;
      return element.isTypeOnly ? `type ${alias}` : alias;
    })
    .join(", ");
  const typePrefix = clause.isTypeOnly ? " type" : "";
  return `import${typePrefix} { ${bindings} } from ${quote}${moduleSpecifier}${quote};`;
}

function applyReplacements(code: string, replacements: Replacement[]) {
  return [...replacements]
    .sort((left, right) => right.start - left.start)
    .reduce(
      (result, replacement) =>
        `${result.slice(0, replacement.start)}${replacement.text}${result.slice(replacement.end)}`,
      code
    );
}
