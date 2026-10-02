import path from "node:path";

import ts from "typescript";

import type { PomCompilerOptions } from "./derivePomManifests";
import { createPomTransform } from "./transformPomModule";

// Only the webpack loader methods used by this integration. No webpack dependency.
type LoaderContext = {
  resourcePath: string;
  getOptions(): PomCompilerOptions;
  addDependency?: (fileName: string) => void;
};

/** Experimental .ts POM loader. Configure it on Turbopack's browser graph only. */
export default function turbopackLoader(this: LoaderContext, source: string) {
  const options = this.getOptions();
  const transformed = createPomTransform(options)(
    source,
    this.resourcePath,
    (dependencies) => {
      if (dependencies.length === 0) return;
      if (!this.addDependency)
        throw new Error(
          "Ayme's Turbopack loader requires loader dependency tracking."
        );
      const resourcePath = path.resolve(this.resourcePath);
      for (const dependency of dependencies) {
        if (path.resolve(dependency) !== resourcePath)
          this.addDependency(dependency);
      }
    }
  );

  // Turbopack's custom loaders must return JavaScript, including when a content
  // filter matched a comment or string rather than a decorated POM class.
  const result = ts.transpileModule(transformed?.code ?? source, {
    fileName: this.resourcePath,
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
      `Could not transpile Ayme POM ${this.resourcePath}: ${errors
        .map((error) =>
          ts.flattenDiagnosticMessageText(error.messageText, "\n")
        )
        .join("\n")}`
    );

  return result.outputText;
}
