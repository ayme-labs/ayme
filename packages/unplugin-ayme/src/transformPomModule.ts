import {
  derivePomManifestsFromProgram,
  type PomCompilerOptions,
} from "./derivePomManifests";
import {
  carriesPomMarker,
  createPomProgram,
  importsPomModule,
  pomProgramDependencies,
} from "./pomProgram";
import { rewritePomImports } from "./rewritePomImports";

const REGISTRATION_MODULE = "@ayme-dev/ayme/internal";

/**
 * The bare specifiers the transform adds to a Page Object module. Vite's
 * dependency scan reads sources untransformed, so it must be told about them.
 */
export const INJECTED_IMPORTS = [REGISTRATION_MODULE];

/** The source transform shared by Vite and the experimental Turbopack loader. */
export function createPomTransform(options: PomCompilerOptions = {}) {
  return (
    code: string,
    id: string,
    reportDependencies?: (dependencies: readonly string[]) => void
  ) => {
    const fileName = id.split("?")[0];
    if (!fileName?.endsWith(".ts") || !isPomCandidate(code, fileName, options))
      return null;

    // Reported before deriving, so a bundler that caches a failed or empty
    // result still reruns it when an input changes. A dependency read
    // mid-write otherwise pins the failure until the Page Object changes.
    const dependencies = pomProgramDependencies(fileName, options);
    reportDependencies?.(dependencies);

    const program = createPomProgram(fileName, options);
    const manifests = derivePomManifestsFromProgram(fileName, program);
    if (manifests.length === 0) return null;

    const rewrittenCode = rewritePomImports(code, fileName, options, program);
    const registrations = manifests
      .map(
        (manifest) =>
          `registerCompiledPom(${manifest.className}, ${JSON.stringify(manifest)});`
      )
      .join("\n");

    return {
      code: `import { registerCompiledPom } from '${REGISTRATION_MODULE}';\n${rewrittenCode}\n${registrations}\n`,
      map: null,
      dependencies,
    };
  };
}

/**
 * A module may declare a Page Object Model when it carries `@ayme`, or when it
 * extends something and imports, directly or transitively, a module that does.
 * The Program built next decides through the class's ancestors.
 */
function isPomCandidate(
  code: string,
  fileName: string,
  options: PomCompilerOptions
) {
  if (carriesPomMarker(code)) return true;
  // ponytail: stateless per-module gate. Ceiling: every false positive (a
  // module with `extends` that imports a decorated module but declares no Page
  // Object Model) costs one Program build. Upgrade: a Program cached across
  // transforms, if a large app makes that matter.
  return code.includes("extends") && importsPomModule(fileName, options);
}
