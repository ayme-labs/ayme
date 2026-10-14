import path from "node:path";

import type ts from "typescript";

import {
  derivePomManifestsFromProgram,
  type PomCompilerOptions,
  type SkippedPomMethod,
} from "./derivePomManifests";
import {
  carriesPomMarker,
  createPomProgram,
  importsPomModule,
  pomProgramDependencies,
  pomProjectConfig,
} from "./pomProgram";
import { rewritePomImports } from "./rewritePomImports";

const REGISTRATION_MODULE = "@ayme-dev/ayme/internal";

/**
 * The bare specifiers the transform adds to a Page Object module. Vite's
 * dependency scan reads sources untransformed, so it must be told about them.
 */
export const INJECTED_IMPORTS = [REGISTRATION_MODULE];

/**
 * Page Object compile Programs by tsconfig path. The bundler adapter that owns
 * it clears it when a build ends or a watched file changes (ADR-0036).
 */
export type PomPrograms = Map<string, ts.Program>;

/**
 * The source transform shared by Vite, Angular and the Turbopack loader. With
 * `programs`, transforms of one tsconfig project share a Program.
 */
export function createPomTransform(
  options: PomCompilerOptions = {},
  onSkipped?: (fileName: string, methods: SkippedPomMethod[]) => void,
  programs?: PomPrograms
) {
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

    const program = pomProgramFor(fileName, options, programs);
    let manifests;
    try {
      manifests = derivePomManifestsFromProgram(
        fileName,
        program,
        onSkipped && ((methods) => onSkipped(fileName, methods))
      );
    } catch (error) {
      // A bundler may watch this module's dependencies only after a transform
      // succeeds, so a retry must not reuse the Program that read the broken
      // input.
      programs?.clear();
      throw error;
    }
    if (manifests.length === 0) return null;

    const rewrittenCode = rewritePomImports(code, fileName, program);
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

function pomProgramFor(
  fileName: string,
  options: PomCompilerOptions,
  programs: PomPrograms | undefined
) {
  if (!programs) return createPomProgram(fileName, options);
  const config = pomProjectConfig(fileName, options);
  const absoluteFileName = path.resolve(fileName);
  // A module outside its project's files would change the root files of the
  // project's cached Program, so it gets a Program of its own.
  if (!config.fileNames.some((name) => path.resolve(name) === absoluteFileName))
    return createPomProgram(fileName, options, config);
  const configPath = path.resolve(config.options.configFilePath as string);
  let program = programs.get(configPath);
  if (!program)
    programs.set(
      configPath,
      (program = createPomProgram(fileName, options, config))
    );
  return program;
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
  // Object Model) costs one Program build where no build caches Programs, as
  // in the Turbopack loader.
  return code.includes("extends") && importsPomModule(fileName, options);
}
