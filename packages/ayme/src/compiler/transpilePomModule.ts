import { ts } from "./typescriptApi";

import { PomCompileError, typeScriptDiagnostic } from "./pomCompileError";

/**
 * Transpiles a module to JavaScript with fixed settings, for callers that
 * must return JavaScript: the Turbopack loader, the esbuild adapter and
 * `ayme mcp`, through the compiler's `compile` and `transpile`. A byte order
 * mark `code` starts with is left out, as TypeScript leaves it out of a file
 * it reads, so an error's line and column are those an editor shows.
 */
export function transpilePomModule(code: string, fileName: string) {
  const result = ts.transpileModule(code.replace(/^\uFEFF/, ""), {
    fileName,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      experimentalDecorators: true,
      useDefineForClassFields: true,
      verbatimModuleSyntax: true,
    },
  });
  const errors = result.diagnostics?.filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error
  );
  if (errors?.length)
    throw new PomCompileError(errors.map(typeScriptDiagnostic));

  return result.outputText;
}
