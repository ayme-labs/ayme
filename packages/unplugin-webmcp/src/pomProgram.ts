import path from "node:path";

import ts from "typescript";

export type PomCompilerOptions = {
  tsconfigPath?: string;
};

type PomProgramOptions = {
  fallbackToUnconfigured?: boolean;
  onDependency?: (fileName: string) => void;
};

export function createPomProgram(
  fileName: string,
  options: PomCompilerOptions = {},
  { fallbackToUnconfigured = false, onDependency }: PomProgramOptions = {}
) {
  const absoluteFileName = path.resolve(fileName);

  let config: ts.ParsedCommandLine;
  try {
    config = projectConfigFor(
      absoluteFileName,
      options,
      fallbackToUnconfigured,
      onDependency
    );
  } catch (error) {
    if (!fallbackToUnconfigured) throw error;
    const program = ts.createProgram([absoluteFileName], {});
    reportProgramDependencies(program, onDependency);
    return program;
  }

  const program = ts.createProgram({
    rootNames: [...new Set([...config.fileNames, absoluteFileName])],
    options: {
      ...config.options,
      noEmit: true,
    },
  });
  reportProgramDependencies(program, onDependency);
  return program;
}

export function pomProgramDependencies(
  fileName: string,
  options: PomCompilerOptions = {}
) {
  const absoluteFileName = path.resolve(fileName);
  const dependencies = new Set<string>();
  const report = (dependency: string) =>
    dependencies.add(path.resolve(dependency));
  const config = projectConfigFor(absoluteFileName, options, false, report);

  for (const projectFile of config.fileNames) report(projectFile);
  reportImportedModules(absoluteFileName, config.options, dependencies);
  return [...dependencies].sort();
}

/**
 * Whether a module's transitive local imports include one whose text carries
 * `@WebMCP`, found with the same import walk as `pomProgramDependencies`.
 */
export function importsWebMcpModule(
  fileName: string,
  options: PomCompilerOptions = {}
) {
  const absoluteFileName = path.resolve(fileName);
  let compilerOptions: ts.CompilerOptions = {};
  try {
    compilerOptions = projectConfigFor(absoluteFileName, options, true).options;
  } catch {
    // Without a readable tsconfig, resolve with TypeScript's defaults.
  }
  const importedModules = new Set<string>();
  reportImportedModules(absoluteFileName, compilerOptions, importedModules);
  return [...importedModules].some((importedModule) =>
    ts.sys.readFile(importedModule)?.includes("@WebMCP")
  );
}

function reportImportedModules(
  fileName: string,
  compilerOptions: ts.CompilerOptions,
  dependencies: Set<string>,
  visited = new Set<string>()
) {
  const absoluteFileName = path.resolve(fileName);
  if (visited.has(absoluteFileName)) return;
  visited.add(absoluteFileName);

  const source = ts.sys.readFile(absoluteFileName);
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

    const dependency = path.resolve(resolved.resolvedFileName);
    dependencies.add(dependency);
    reportImportedModules(dependency, compilerOptions, dependencies, visited);
  }
}

function projectConfigFor(
  fileName: string,
  options: PomCompilerOptions,
  allowConfigErrors: boolean,
  onDependency?: (fileName: string) => void
): ts.ParsedCommandLine {
  const configPath = options.tsconfigPath
    ? path.resolve(options.tsconfigPath)
    : ts.findConfigFile(
        path.dirname(fileName),
        ts.sys.fileExists,
        "tsconfig.json"
      );
  if (!configPath)
    throw new Error(
      `Could not find a tsconfig.json for POM source ${fileName}.`
    );

  onDependency?.(configPath);
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error) throw configError(configPath, configFile.error);

  const parseHost: ts.ParseConfigHost = onDependency
    ? {
        ...ts.sys,
        readFile(fileName) {
          const contents = ts.sys.readFile(fileName);
          if (contents !== undefined) onDependency(path.resolve(fileName));
          return contents;
        },
      }
    : ts.sys;
  const config = ts.parseJsonConfigFileContent(
    configFile.config,
    parseHost,
    path.dirname(configPath)
  );
  const error = config.errors[0];
  if (error && !allowConfigErrors) throw configError(configPath, error);
  return config;
}

function reportProgramDependencies(
  program: ts.Program,
  onDependency: ((fileName: string) => void) | undefined
) {
  if (!onDependency) return;
  for (const sourceFile of program.getSourceFiles()) {
    if (program.isSourceFileDefaultLibrary(sourceFile)) continue;
    onDependency(path.resolve(sourceFile.fileName));
  }
}

function configError(configPath: string, diagnostic: ts.Diagnostic) {
  return new Error(
    `Could not read TypeScript project configuration ${configPath}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`
  );
}
