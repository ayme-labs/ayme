import {
  chain,
  SchematicsException,
  type Rule,
  type Tree,
} from "@angular-devkit/schematics";
import {
  addDependency,
  addRootProvider,
  DependencyType,
  readWorkspace,
  updateWorkspace,
} from "@schematics/angular/utility";
import { isStandaloneApp } from "@schematics/angular/utility/ng-ast-utils";

import { version } from "../../package.json";

export type NgAddOptions = { project?: string };

const pluginFile = "ayme.plugin.mjs";
const pluginEntry = (tsconfigPath: string) => ({
  path: `./${pluginFile}`,
  options: { tsconfigPath },
});
const customEsbuild = {
  application: "@angular-builders/custom-esbuild:application",
  devServer: "@angular-builders/custom-esbuild:dev-server",
};
// The standard builders of Angular 19 and of Angular 20 and later.
const replaced: Record<string, string> = {
  "@angular-devkit/build-angular:application": customEsbuild.application,
  "@angular/build:application": customEsbuild.application,
  "@angular-devkit/build-angular:dev-server": customEsbuild.devServer,
  "@angular/build:dev-server": customEsbuild.devServer,
};
const replaceable = (builder: string | undefined) =>
  builder !== undefined &&
  (builder in replaced || Object.values(customEsbuild).includes(builder));

/**
 * `ng add @ayme-dev/angular`: installs Ayme's runtime and build integration,
 * switches the build and serve targets to custom-esbuild with Ayme's plugin,
 * and adds `provideAyme()` to the application config. What it cannot change
 * safely, it leaves alone and lists as manual steps.
 */
export function ngAdd(options: NgAddOptions): Rule {
  return async (tree) => {
    const workspace = await readWorkspace(tree);
    const projectName =
      options.project ??
      [...workspace.projects].find(
        ([, project]) => project.extensions["projectType"] === "application"
      )?.[0];
    const project = projectName
      ? workspace.projects.get(projectName)
      : undefined;
    if (!projectName || project?.extensions["projectType"] !== "application")
      throw new SchematicsException(
        `Ayme needs an Angular application project; ${projectName ? `"${projectName}" is not one` : "the workspace has none"}.`
      );
    const build = project.targets.get("build");
    const serve = project.targets.get("serve");
    const tsconfigPath = build?.options?.["tsConfig"];
    const main = build?.options?.["browser"] ?? build?.options?.["main"];
    const manual: string[] = [];
    const rules: Rule[] = [
      addDependency("@ayme-dev/ayme", version),
      addDependency("@ayme-dev/unplugin-ayme", version, {
        type: DependencyType.Dev,
      }),
    ];

    // addRootProvider finds the application config through the build
    // target, so it runs before the builder swap, and only for the standard
    // builders it understands.
    if (
      build?.builder !== undefined &&
      build.builder in replaced &&
      typeof main === "string" &&
      tree.exists(main) &&
      isStandaloneApp(tree, main)
    )
      rules.push(
        addRootProvider(
          projectName,
          ({ code, external }) =>
            code`${external("provideAyme", "@ayme-dev/angular")}()`
        )
      );
    else
      manual.push(
        `ng add could not add provideAyme() to "${projectName}": it is not a standalone application built with Angular's standard builder. Add provideAyme() from @ayme-dev/angular to the providers of your application config, or of your root NgModule.`
      );

    if (
      replaceable(build?.builder) &&
      replaceable(serve?.builder) &&
      typeof tsconfigPath === "string"
    ) {
      rules.push(
        addDependency(
          "@angular-builders/custom-esbuild",
          `^${angularMajor(tree)}.0.0`,
          { type: DependencyType.Dev }
        ),
        updateWorkspace((workspace) => {
          const targets = workspace.projects.get(projectName)!.targets;
          const build = targets.get("build")!;
          const serve = targets.get("serve")!;
          build.builder = replaced[build.builder] ?? build.builder;
          serve.builder = replaced[serve.builder] ?? serve.builder;
          const buildOptions = (build.options ??= {});
          const plugins = Array.isArray(buildOptions["plugins"])
            ? buildOptions["plugins"]
            : [];
          if (
            !plugins.some((plugin) =>
              JSON.stringify(plugin).includes(pluginFile)
            )
          )
            buildOptions["plugins"] = [...plugins, pluginEntry(tsconfigPath)];
        }),
        (tree) => {
          if (!tree.exists(pluginFile))
            tree.create(
              pluginFile,
              'export { default } from "@ayme-dev/unplugin-ayme/angular";\n'
            );
        }
      );
    } else {
      manual.push(
        `The build or serve target of "${projectName}" does not use Angular's standard builder (build: ${build?.builder ?? "none"}, serve: ${serve?.builder ?? "none"}), so ng add left angular.json alone. Ayme's compiler needs an esbuild plugin:`,
        `  - Create ${pluginFile} at the workspace root: export { default } from "@ayme-dev/unplugin-ayme/angular";`,
        `  - Add { "path": "./${pluginFile}", "options": { "tsconfigPath": "<your app tsconfig>" } } to the build target's "plugins". With Angular's standard builders, first install @angular-builders/custom-esbuild for your Angular major and switch to ${customEsbuild.application} and ${customEsbuild.devServer}.`
      );
    }

    return chain([
      ...rules,
      (_, context) => {
        if (manual.length === 0)
          context.logger.info(
            "Ayme is set up. Turn WebMCP publication on with provideAyme({ webMCP: { enabled: true } })."
          );
        else for (const line of manual) context.logger.warn(line);
      },
    ]);
  };
}

function angularMajor(tree: Tree) {
  const manifest = tree.readJson("package.json") as {
    dependencies?: Record<string, string>;
  };
  const major = manifest.dependencies?.["@angular/core"]?.match(/\d+/)?.[0];
  if (!major)
    throw new SchematicsException(
      "Ayme could not find @angular/core in package.json dependencies."
    );
  return major;
}
