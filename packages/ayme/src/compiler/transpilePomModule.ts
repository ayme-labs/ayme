import ts from "typescript";

/**
 * Transpiles a module to JavaScript with fixed settings, for callers that
 * must return JavaScript: the Turbopack loader, the esbuild adapter and
 * `ayme mcp`, through the compiler's `compile` and `transpile`.
 */
export function transpilePomModule(code: string, fileName: string) {
  const result = ts.transpileModule(code, {
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
    throw new Error(
      `Could not transpile Ayme POM ${fileName}: ${errors
        .map((error) =>
          ts.flattenDiagnosticMessageText(error.messageText, "\n")
        )
        .join("\n")}`
    );

  return result.outputText;
}
