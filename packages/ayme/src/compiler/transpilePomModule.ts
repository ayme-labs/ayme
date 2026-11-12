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
      `Could not transpile Ayme POM ${fileName}:\n${errors
        .map(diagnosticLine)
        .join("\n")}`
    );

  return result.outputText;
}

/**
 * One diagnostic on its own line: its file, 1-based line and column, and
 * its text. A diagnostic without a file or a start keeps its text alone.
 */
function diagnosticLine(diagnostic: ts.Diagnostic): string {
  const text = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  const { file, start } = diagnostic;
  if (file === undefined || start === undefined) return text;
  // TypeScript counts the line and the column from 0.
  const { line, character } = ts.getLineAndCharacterOfPosition(file, start);
  return `${file.fileName}:${line + 1}:${character + 1}: ${text}`;
}
