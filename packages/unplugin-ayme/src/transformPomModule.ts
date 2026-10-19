import path from "node:path";

import ts from "typescript";

import type { PomManifest } from "@ayme-dev/ayme/internal";

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
/** The entry a build without Ayme resolves `@ayme-dev/ayme` and its internal entry to. */
export const ABSENT_MODULE = "@ayme-dev/ayme/absent";
/**
 * The framework packages, whose root entry a build without Ayme resolves to
 * their own absent entry, `@ayme-dev/<framework>/absent`.
 */
export const FRAMEWORK_MODULES = /^@ayme-dev\/(vue|react|svelte|angular)$/;

export type PomTransformOptions = PomCompilerOptions & {
  /**
   * Whether the build includes Ayme. Nothing else decides: without `true`,
   * the build is a build without Ayme, in which each Page Object Model
   * compiles to a stand-in from the absent entry instead of its
   * implementation. Defaults to false.
   */
  include?: boolean;
};

/**
 * The `include` option as a boolean. Every adapter validates it the same
 * way, so a typo never silently picks the default.
 */
export function includeOption(value: unknown): boolean {
  if (value === undefined) return false;
  if (typeof value !== "boolean")
    throw new TypeError("include must be a boolean");
  return value;
}

/**
 * The one line a build prints saying whether Ayme is in it and why, so a
 * build log shows the decision before anything reaches users. Each adapter
 * prints it once per build.
 */
export function includeLine(value: unknown): string {
  if (includeOption(value))
    return "[ayme] Ayme is in this build: include is true.";
  return `[ayme] Ayme is not in this build: include is ${value === undefined ? "not set" : "false"}.`;
}

/**
 * The bare specifier the transform adds to a Page Object module. Vite's
 * dependency scan reads sources untransformed, so it must be told about it.
 */
export function injectedImport(options: PomTransformOptions) {
  return includeOption(options.include) ? REGISTRATION_MODULE : ABSENT_MODULE;
}

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
  options: PomTransformOptions = {},
  onSkipped?: (fileName: string, methods: SkippedPomMethod[]) => void,
  programs?: PomPrograms
) {
  const include = includeOption(options.include);
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
    if (!include)
      return {
        code: standInModule(rewrittenCode, fileName, manifests),
        map: null,
        dependencies,
      };
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
 * The module with each Page Object Model replaced by a stand-in of the same
 * name and export, whose actions and Page Object Children fail naming
 * themselves. Everything else in the module stays.
 */
function standInModule(
  code: string,
  fileName: string,
  manifests: readonly PomManifest[]
) {
  const sourceFile = ts.createSourceFile(
    fileName,
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const byName = new Map(
    manifests.map((manifest) => [manifest.className, manifest])
  );
  const classes = sourceFile.statements.filter(
    (statement): statement is ts.ClassDeclaration & { name: ts.Identifier } =>
      ts.isClassDeclaration(statement) &&
      statement.name !== undefined &&
      byName.has(statement.name.text)
  );
  for (const className of byName.keys())
    if (!classes.some((declaration) => declaration.name.text === className))
      throw new Error(
        `Ayme could not remove Page Object Model ${className} from ${fileName}: it is not a top-level class.`
      );

  let result = "";
  let cursor = 0;
  for (const declaration of classes) {
    const manifest = byName.get(declaration.name.text)!;
    const modifiers = (declaration.modifiers ?? [])
      .filter(
        (modifier) =>
          modifier.kind === ts.SyntaxKind.ExportKeyword ||
          modifier.kind === ts.SyntaxKind.DefaultKeyword
      )
      .map((modifier) => `${modifier.getText(sourceFile)} `)
      .join("");
    const shape = {
      actions: manifest.tools.map((tool) => tool.methodName),
      properties: manifest.members
        .filter((member) => member.access !== "method")
        .map((member) => member.memberName),
      methods: manifest.members
        .filter((member) => member.access === "method")
        .map((member) => member.memberName),
    };
    result +=
      code.slice(cursor, declaration.getStart(sourceFile)) +
      `${modifiers}class ${manifest.className} extends absentPageObject(${JSON.stringify(manifest.className)}, ${JSON.stringify(shape)}) {}`;
    cursor = declaration.getEnd();
  }
  return `import { absentPageObject } from '${ABSENT_MODULE}';\n${withoutUnusedImports(result + code.slice(cursor), fileName)}`;
}

/**
 * The module without the imports only its replaced Page Object Models used,
 * so what they imported for their implementation, Ayme's decorators
 * included, leaves the build with them. A bare import for its side effects
 * stays, as does every binding the rest of the module references.
 */
function withoutUnusedImports(code: string, fileName: string) {
  const sourceFile = ts.createSourceFile(
    fileName,
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const referenced = new Set<string>();
  const collect = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) return;
    if (ts.isIdentifier(node)) referenced.add(node.text);
    ts.forEachChild(node, collect);
  };
  collect(sourceFile);

  let result = "";
  let cursor = 0;
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause) continue;
    const { name, namedBindings } = statement.importClause;
    const defaultName = name && referenced.has(name.text) ? name.text : "";
    const named =
      namedBindings && ts.isNamedImports(namedBindings)
        ? namedBindings.elements
            .filter((element) => referenced.has(element.name.text))
            .map((element) => element.getText(sourceFile))
        : [];
    const namespace =
      namedBindings &&
      ts.isNamespaceImport(namedBindings) &&
      referenced.has(namedBindings.name.text)
        ? namedBindings.getText(sourceFile)
        : "";
    const bindings = [
      defaultName,
      namespace,
      named.length > 0 ? `{ ${named.join(", ")} }` : "",
    ].filter(Boolean);
    const unchanged =
      (!name || defaultName) &&
      (!namedBindings ||
        namespace ||
        (ts.isNamedImports(namedBindings) &&
          named.length === namedBindings.elements.length));
    if (unchanged) continue;
    result += code.slice(cursor, statement.getStart(sourceFile));
    if (bindings.length > 0)
      result += `import ${statement.importClause.isTypeOnly ? "type " : ""}${bindings.join(", ")} from ${statement.moduleSpecifier.getText(sourceFile)};`;
    cursor = statement.getEnd();
  }
  return result + code.slice(cursor);
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
