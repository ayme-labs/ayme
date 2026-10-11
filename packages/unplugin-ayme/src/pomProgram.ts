import path from "node:path";

import ts from "typescript";

export type PomCompilerOptions = {
  tsconfigPath?: string;
};

/** The TypeScript project a Page Object Model module compiles with. */
export function pomProjectConfig(
  fileName: string,
  options: PomCompilerOptions = {}
) {
  return projectConfigFor(path.resolve(fileName), options);
}

export function createPomProgram(
  fileName: string,
  options: PomCompilerOptions = {},
  config = pomProjectConfig(fileName, options)
) {
  return ts.createProgram({
    rootNames: [...new Set([...config.fileNames, path.resolve(fileName)])],
    options: {
      ...config.options,
      noEmit: true,
    },
  });
}

export function pomProgramDependencies(
  fileName: string,
  options: PomCompilerOptions = {}
) {
  const absoluteFileName = path.resolve(fileName);
  const dependencies = new Set<string>();
  const report = (dependency: string) =>
    dependencies.add(path.resolve(dependency));
  const config = projectConfigFor(absoluteFileName, options, report);

  for (const projectFile of config.fileNames) report(projectFile);
  walkImportedModules(absoluteFileName, config.options, report);
  return [...dependencies].sort();
}

/**
 * Whether source text carries the Page Object decorator `@ayme`. The
 * `@ayme-dev/...` import specifiers do not count.
 */
export function carriesPomMarker(source: string) {
  return /@ayme\b(?!-)/.test(source);
}

/**
 * Whether a module's transitive local imports include one that carries a Page
 * Object decorator. It walks imports as `pomProgramDependencies` does, without
 * adding the project's root files. Without a tsconfig, imports resolve with
 * TypeScript's defaults; an unreadable tsconfig throws, as the Program build
 * for the same file would.
 */
export function importsPomModule(
  fileName: string,
  options: PomCompilerOptions = {}
) {
  const absoluteFileName = path.resolve(fileName);
  const compilerOptions = projectConfigPath(absoluteFileName, options)
    ? projectConfigFor(absoluteFileName, options).options
    : {};
  let found = false;
  walkImportedModules(absoluteFileName, compilerOptions, (_, source) => {
    found ||= source !== undefined && carriesPomMarker(source);
  });
  return found;
}

/** Calls `onImport` once per transitive local import, with its text if readable. */
function walkImportedModules(
  fileName: string,
  compilerOptions: ts.CompilerOptions,
  onImport: (fileName: string, source: string | undefined) => void,
  visited = new Set<string>()
) {
  const absoluteFileName = path.resolve(fileName);
  if (visited.has(absoluteFileName)) return;
  visited.add(absoluteFileName);

  const source = ts.sys.readFile(absoluteFileName);
  if (visited.size > 1) onImport(absoluteFileName, source);
  if (source === undefined) return;

  const importedFiles = ts.preProcessFile(source, true, true).importedFiles;
  for (const importedFile of importedFiles) {
    const resolved = ts.resolveModuleName(
      importedFile.fileName,
      absoluteFileName,
      compilerOptions,
      ts.sys
    ).resolvedModule;
    if (!resolved || resolved.isExternalLibraryImport) continue;

    walkImportedModules(
      resolved.resolvedFileName,
      compilerOptions,
      onImport,
      visited
    );
  }
}

function projectConfigPath(fileName: string, options: PomCompilerOptions) {
  return options.tsconfigPath
    ? path.resolve(options.tsconfigPath)
    : ts.findConfigFile(
        path.dirname(fileName),
        ts.sys.fileExists,
        "tsconfig.json"
      );
}

function projectConfigFor(
  fileName: string,
  options: PomCompilerOptions,
  onConfigFile?: (fileName: string) => void
): ts.ParsedCommandLine {
  const configPath = projectConfigPath(fileName, options);
  if (!configPath)
    throw new Error(
      `Could not find a tsconfig.json for POM source ${fileName}.`
    );

  let config = parseConfig(configPath, onConfigFile);
  if (config.fileNames.length === 0) {
    // A solution-style tsconfig (`"files": []` plus `references`, as
    // create-vite writes) has no compiler options of its own. Like `tsc -b`
    // and editors, compile with the referenced project that includes the POM.
    config =
      config.projectReferences
        ?.map((reference) =>
          parseConfig(ts.resolveProjectReferencePath(reference), onConfigFile)
        )
        .find((referenced) =>
          referenced.fileNames.some((name) => path.resolve(name) === fileName)
        ) ?? config;
  }

  const error = config.errors[0];
  if (error)
    throw configError(
      path.resolve(config.options.configFilePath as string),
      error
    );
  return config;
}

function parseConfig(
  configPath: string,
  onConfigFile?: (fileName: string) => void
) {
  onConfigFile?.(path.resolve(configPath));
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error) throw configError(configPath, configFile.error);

  const parseHost: ts.ParseConfigHost = onConfigFile
    ? {
        ...ts.sys,
        readFile(fileName) {
          const contents = ts.sys.readFile(fileName);
          if (contents !== undefined) onConfigFile(path.resolve(fileName));
          return contents;
        },
      }
    : ts.sys;
  return ts.parseJsonConfigFileContent(
    configFile.config,
    parseHost,
    path.dirname(configPath),
    undefined,
    configPath
  );
}

function configError(configPath: string, diagnostic: ts.Diagnostic) {
  return new Error(
    `Could not read TypeScript project configuration ${configPath}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`
  );
}
