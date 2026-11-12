import path from "node:path";

import {
  createPomCompiler,
  type PomCompilerOptions,
} from "@ayme-dev/ayme/compiler";

// Only the webpack loader methods used by this integration. No webpack dependency.
type LoaderContext = {
  resourcePath: string;
  getOptions(): Pick<PomCompilerOptions, "tsconfigPath" | "include">;
  addDependency?: (fileName: string) => void;
};

// The loader runs per module, so the line saying whether Ayme is in the
// build is printed once per process.
let announced = false;

/** The .ts POM loader for Next.js. Configure it on Turbopack's browser graph only. */
export default function turbopackLoader(this: LoaderContext, source: string) {
  const { tsconfigPath, include } = this.getOptions();
  // A loader keeps no state between modules (ADR-0036), so each module gets
  // a compiler of its own.
  const compiler = createPomCompiler({ tsconfigPath, include });
  if (!announced) {
    console.info(compiler.includeLine);
    announced = true;
  }
  const compiled = compiler.compile(this.resourcePath, source, {
    emit: "ts",
    onDependencies: (dependencies) => {
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
    },
  });

  // Turbopack's custom loaders must return JavaScript, including when a content
  // filter matched a comment or string rather than a decorated POM class.
  try {
    return compiler.transpile(this.resourcePath, compiled?.code ?? source);
  } catch (error) {
    // The source's own error, if it has one, names the lines as written.
    compiler.transpile(this.resourcePath, source);
    throw error;
  }
}
