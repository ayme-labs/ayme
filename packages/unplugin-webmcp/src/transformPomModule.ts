import {
  derivePomManifestsFromProgram,
  type PomCompilerOptions,
} from "./derivePomManifests";
import {
  createPomProgram,
  importsWebMcpModule,
  pomProgramDependencies,
} from "./pomProgram";
import { rewritePomImports } from "./rewritePomImports";

/** The source transform shared by Vite and the experimental Turbopack loader. */
export function createPomTransform(options: PomCompilerOptions = {}) {
  return (code: string, id: string) => {
    const fileName = id.split("?")[0];
    if (!fileName?.endsWith(".ts") || !isPomCandidate(code, fileName, options))
      return null;

    const program = createPomProgram(fileName, options);
    const manifests = derivePomManifestsFromProgram(fileName, program);
    if (manifests.length === 0) return null;

    const dependencies = pomProgramDependencies(fileName, options);
    const rewrittenCode = rewritePomImports(code, fileName, options, program);
    const registrations = manifests
      .map(
        (manifest) =>
          `registerCompiledPom(${manifest.className}, ${JSON.stringify(manifest)});`
      )
      .join("\n");

    return {
      code: `import { registerCompiledPom } from '@ayme-dev/webmcp/internal';\n${rewrittenCode}\n${registrations}\n`,
      map: null,
      dependencies,
    };
  };
}

/**
 * A module may declare a Page Object Model when it carries `@WebMCP`, or when it
 * extends something and imports, directly or transitively, a module that does.
 * The Program built next decides through the class's ancestors.
 */
function isPomCandidate(
  code: string,
  fileName: string,
  options: PomCompilerOptions
) {
  if (code.includes("@WebMCP")) return true;
  // ponytail: stateless per-module gate. Ceiling: every false positive (a
  // module with `extends` that imports a decorated module but declares no Page
  // Object Model) costs one Program build. Upgrade: a Program cached across
  // transforms, if a large app makes that matter.
  return code.includes("extends") && importsWebMcpModule(fileName, options);
}
