import type { PomManifest } from "../shared";

import {
  derivePomManifests,
  type SkippedPomMethod,
} from "./derivePomManifests";
import {
  absentEntryFor,
  createPomTransform,
  includeLine,
  includeOption,
  injectedImport,
  type PomPrograms,
} from "./transformPomModule";
import { transpilePomModule } from "./transpilePomModule";

export type PomCompilerOptions = {
  /**
   * The tsconfig the compiler reads. Without it, each module compiles with
   * the nearest tsconfig.
   */
  tsconfigPath?: string;
  /**
   * Whether the build includes Ayme. Defaults to false: the runtime's entries
   * then resolve to its absent entry and each Page Object Model compiles to a
   * stand-in. A value that is not a boolean throws a `TypeError`.
   */
  include?: boolean;
  /**
   * Receives, for each compiled file, the public methods of its Page Object
   * Models and their Page Object Children that are neither actions nor
   * declared Page Object Children.
   */
  onSkipped?: (fileName: string, methods: SkippedPomMethod[]) => void;
};

/** A compiled Page Object Model module. */
export type CompiledPom = {
  code: string;
  /**
   * The files the compile read: the tsconfig project's inputs and the
   * module's imports. A bundler watches them and recompiles the module when
   * one changes.
   */
  dependencies: readonly string[];
};

export type PomCompileOptions = {
  /**
   * `"ts"` keeps TypeScript for a bundler that transpiles the module itself;
   * `"js"` transpiles it, decorators included.
   */
  emit: "ts" | "js";
  /**
   * Receives the files the compile reads before it derives anything, so a
   * bundler still watches them when the compile throws.
   */
  onDependencies?: (dependencies: readonly string[]) => void;
};

/**
 * The Page Object compiler of one build. It keeps one TypeScript Program per
 * tsconfig project until `invalidate`; the bundler adapter that owns it says
 * when its inputs may have changed (ADR-0036).
 */
export type PomCompiler = {
  /** The one line a build prints saying whether Ayme is in it and why. */
  readonly includeLine: string;
  /** The bare specifier a compiled module imports. */
  readonly injectedImport: string;
  /**
   * The Page Object Model module `fileName` compiled from `source`, or null
   * when it declares no Page Object Model. `fileName` may carry a query.
   */
  compile(
    fileName: string,
    source: string,
    options: PomCompileOptions
  ): CompiledPom | null;
  /** Any module transpiled to JavaScript, as `compile` emits it. */
  transpile(fileName: string, source: string): string;
  /**
   * What a build without Ayme resolves `specifier` to, or undefined when the
   * specifier does not leave such a build.
   */
  absentEntry(specifier: string): string | undefined;
  /** Drops the cached Programs: a build started or ended, or a file changed. */
  invalidate(): void;
  /** The manifests of each Page Object Model in `fileName`, read afresh. */
  derivePomManifests(fileName: string): PomManifest[];
};

export function createPomCompiler(
  options: PomCompilerOptions = {}
): PomCompiler {
  const include = includeOption(options.include);
  const { tsconfigPath, onSkipped } = options;
  const programs: PomPrograms = new Map();
  const transform = createPomTransform(
    { tsconfigPath, include },
    onSkipped,
    programs
  );
  return {
    includeLine: includeLine(options.include),
    injectedImport: injectedImport(include),
    compile(fileName, source, { emit, onDependencies }) {
      const transformed = transform(source, fileName, onDependencies);
      if (!transformed) return null;
      return {
        code:
          emit === "js"
            ? transpilePomModule(transformed.code, fileName.split("?")[0]!)
            : transformed.code,
        dependencies: transformed.dependencies,
      };
    },
    transpile: (fileName, source) => transpilePomModule(source, fileName),
    absentEntry: absentEntryFor,
    invalidate: () => programs.clear(),
    derivePomManifests: (fileName) =>
      derivePomManifests(fileName, { tsconfigPath }),
  };
}
