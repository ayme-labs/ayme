import { readFile } from "node:fs/promises";
import path from "node:path";

import type { Plugin } from "esbuild";

import { createPomTransform } from "./transformPomModule";
import { transpilePomModule } from "./transpilePomModule";

export type AymeAngularOptions = {
  /**
   * The tsconfig Ayme's compiler reads, resolved from the workspace root.
   * Point it at the app's own tsconfig, which Angular's watcher also reads.
   */
  tsconfigPath?: string;
};

const namespace = "ayme-pom";
const suffix = "?ayme-pom";

type CompiledPom = { contents: string; watchFiles: readonly string[] };

/**
 * esbuild code plugin for Angular's application builder, which consumers
 * reach through `@angular-builders/custom-esbuild`.
 */
export function aymeAngular(options: AymeAngularOptions = {}): Plugin {
  const unknown = Object.keys(options).filter((key) => key !== "tsconfigPath");
  if (unknown.length > 0)
    throw new TypeError(
      `Ayme's Angular plugin has no option(s): ${unknown.join(", ")}`
    );
  if (
    options.tsconfigPath !== undefined &&
    typeof options.tsconfigPath !== "string"
  )
    throw new TypeError("tsconfigPath must be a string");
  return {
    name: "ayme-angular",
    setup(build) {
      // Server bundles keep Angular's emit: SSR never constructs Page Objects.
      if (build.initialOptions.platform === "node") return;
      const root = build.initialOptions.absWorkingDir ?? process.cwd();
      const transformPom = createPomTransform({
        tsconfigPath:
          options.tsconfigPath && path.resolve(root, options.tsconfigPath),
      });
      // One compilation per module and build; a rebuild starts afresh so an
      // edited dependency reaches the manifest.
      let compiled = new Map<string, Promise<CompiledPom | null>>();
      build.onStart(() => {
        compiled = new Map();
      });

      const compile = async (fileName: string) => {
        const source = await readFile(fileName, "utf8");
        const transformed = transformPom(source, fileName);
        if (!transformed) return null;
        return {
          contents: transpilePomModule(transformed.code, fileName),
          watchFiles: transformed.dependencies,
        };
      };

      // Angular's compiler plugin runs first and serves every program file
      // from its own `onLoad`, which has no namespace filter. So a Page Object
      // Model module is claimed while resolving, into a namespace and a path
      // that Angular's `/\.[cm]?[jt]sx?$/` filter does not match. Every other
      // module, including each Angular component, stays with Angular. Bare
      // specifiers count too: tsconfig `paths` resolve them into the workspace.
      build.onResolve({ filter: /.*/ }, async (args) => {
        if (args.pluginData?.[namespace]) return;
        // A claimed module's own imports arrive from its namespace; resolving
        // them here keeps one copy of an imported base Page Object Model.
        if (args.namespace !== "file" && args.namespace !== namespace) return;
        const resolved = await build.resolve(args.path, {
          kind: args.kind,
          importer: args.importer.replace(suffix, ""),
          namespace: "file",
          resolveDir: args.resolveDir,
          pluginData: { [namespace]: true },
        });
        if (
          resolved.errors.length > 0 ||
          resolved.external ||
          !resolved.path.endsWith(".ts") ||
          resolved.path.split(path.sep).includes("node_modules")
        )
          return;
        let pom = compiled.get(resolved.path);
        if (!pom) compiled.set(resolved.path, (pom = compile(resolved.path)));
        if (!(await pom)) return;
        return { path: resolved.path + suffix, namespace };
      });

      build.onLoad({ filter: /\?ayme-pom$/, namespace }, async (args) => {
        const fileName = args.path.slice(0, -suffix.length);
        const pom = await compiled.get(fileName);
        if (!pom)
          throw new Error(
            `Ayme did not compile Page Object Model ${fileName}.`
          );
        return {
          contents: pom.contents,
          loader: "js",
          resolveDir: path.dirname(fileName),
          watchFiles: [...pom.watchFiles],
        };
      });
    },
  };
}

/** The factory `@angular-builders/custom-esbuild` calls with `{ path, options }`. */
export default aymeAngular;
