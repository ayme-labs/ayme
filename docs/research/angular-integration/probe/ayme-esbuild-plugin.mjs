// PROBE: Angular application-builder code plugin carrying Ayme's existing POM
// transform. It reuses the published Turbopack loader entry (transform + TS
// transpile) because createPomTransform is not exported on main a94a159.
import { readFile } from "node:fs/promises";
import path from "node:path";
import turbopackLoader from "@ayme-dev/unplugin-ayme/turbopack-loader";

const namespace = "ayme-pom";
const suffix = "?ayme-pom";

export default function aymeAngularPlugin({ define, ...options } = {}) {
  options.define = define;
  if (options.tsconfigPath)
    options = { ...options, tsconfigPath: path.resolve(options.tsconfigPath) };
  return {
    name: "ayme-angular-probe",
    setup(build) {
      const platform = build.initialOptions.platform;
      console.log(`[ayme-probe] setup platform=${platform}`);
      // No build constants here: a define set on esbuild's initialOptions does
      // not reach dependencies the dev server prebundles with Vite (probe 2).
      // The temporary publication constant is set with Angular's `define` option.
      // Probe-only: Angular 17.1 has no `define` builder option (added in 17.2).
      if (options.define)
        build.initialOptions.define = {
          ...build.initialOptions.define,
          ...options.define,
        };
      // Server bundles keep Angular's own compilation: Page Objects stay inert.
      if (platform === "node") return;
      const compiled = new Map();
      build.onResolve({ filter: /^\.{1,2}\// }, async (args) => {
        if (args.pluginData?.ayme || args.namespace !== "file") return;
        const resolved = await build.resolve(args.path, {
          kind: args.kind,
          importer: args.importer,
          resolveDir: args.resolveDir,
          pluginData: { ayme: true },
        });
        if (
          resolved.errors.length ||
          !resolved.path.endsWith(".ts") ||
          resolved.path.includes("/node_modules/")
        )
          return;
        const source = await readFile(resolved.path, "utf8");
        if (!/@WebMCP|extends/.test(source)) return;
        const watchFiles = [];
        const contents = turbopackLoader.call(
          {
            resourcePath: resolved.path,
            getOptions: () => options,
            addDependency: (file) => watchFiles.push(file),
          },
          source
        );
        // Claim only modules that declare a Page Object Model; everything else,
        // including Angular components, stays with Angular's compiler.
        if (!contents.includes("registerCompiledPom(")) return;
        console.log(
          `[ayme-probe] compiled ${path.basename(resolved.path)} deps=${watchFiles.length}`
        );
        compiled.set(resolved.path, { contents, watchFiles });
        // Angular's TS onLoad has no namespace filter and matches /\.[cm]?[jt]sx?$/,
        // so the claimed path must not end in .ts or Angular serves its own emit.
        return { path: resolved.path + suffix, namespace };
      });
      build.onLoad({ filter: /\?ayme-pom$/, namespace }, (args) => {
        const file = args.path.slice(0, -suffix.length);
        const { contents, watchFiles } = compiled.get(file);
        return {
          contents,
          loader: "js",
          resolveDir: path.dirname(file),
          watchFiles,
        };
      });
    },
  };
}
