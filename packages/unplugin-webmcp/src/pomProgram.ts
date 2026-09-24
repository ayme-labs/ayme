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
  walkImportedModules(absoluteFileName, config.options, report);
  return [...dependencies].sort();
}

/**
 * Whether a module's transitive local imports include one whose text carries
 * `@WebMCP`. It walks imports as `pomProgramDependencies` does, without adding
 * the project's root files. Without a tsconfig, imports resolve with
 * TypeScript's defaults; an unreadable tsconfig throws, as the Program build
 * for the same file would.
 */
export function importsWebMcpModule(
  fileName: string,
  options: PomCompilerOptions = {}
) {
  const absoluteFileName = path.resolve(fileName);
  const compilerOptions = projectConfigPath(absoluteFileName, options)
    ? projectConfigFor(absoluteFileName, options, false).options
    : {};
  let found = false;
  walkImportedModules(absoluteFileName, compilerOptions, (_, source) => {
    found ||= source?.includes("@WebMCP") ?? false;
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
  allowConfigErrors: boolean,
  onDependency?: (fileName: string) => void
): ts.ParsedCommandLine {
  const configPath = projectConfigPath(fileName, options);
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
