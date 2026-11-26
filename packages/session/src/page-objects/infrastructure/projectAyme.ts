import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Effect } from "effect";

import { SessionStartError } from "../../session/domain";

/** What a Session runs a project's Page Objects with: the files of the
 * project's own `@ayme-dev/ayme`, and the project's Page Objects entry. */
export type ProjectAyme = {
  /** `ayme/page-objects.ts`, whose default export lists the classes. */
  readonly entry: string;
  /** Its `./compiler` entry, which compiles the Page Object Models. */
  readonly compiler: string;
  /** Its `./playwright` entry, the Node Host the compiled classes
   * register with. */
  readonly nodeHost: string;
};

/** The project's Page Objects entry, in its ayme folder. */
export const ENTRY = join("ayme", "page-objects.ts");

type Manifest = {
  readonly version?: string;
  readonly exports?: Record<string, unknown>;
};

/**
 * The folder of `@ayme-dev/ayme` installed in the project: in the
 * `node_modules` of the project folder or of a folder above it, as the
 * project's Playwright is found. Node's own resolver is not used: it also
 * searches `NODE_PATH`, which could hand the Session another project's copy.
 */
function installedAyme(projectDir: string): string | undefined {
  for (let dir = resolve(projectDir); ; dir = dirname(dir)) {
    const folder = join(dir, "node_modules", "@ayme-dev", "ayme");
    if (existsSync(join(folder, "package.json"))) return folder;
    if (dirname(dir) === dir) return undefined;
  }
}

/** The file an import of the package's `subpath` loads in Node. */
function entryFile(
  folder: string,
  { exports }: Manifest,
  subpath: string
): string | undefined {
  const target = exports?.[subpath];
  const file =
    typeof target === "string"
      ? target
      : ((target as { import?: string; default?: string } | undefined)
          ?.import ?? (target as { default?: string } | undefined)?.default);
  return file === undefined ? undefined : join(folder, file);
}

const install = (version: string) =>
  `"npm install -D @ayme-dev/ayme@${version}"`;

/**
 * The project's own `@ayme-dev/ayme` and Page Objects entry, refused unless
 * the copy is `aymeVersion`, the version of this ayme: the packages are
 * released together, so only the same version pairs. Compiled Page Objects
 * register with the copy they import, so the Session runs that copy and
 * never one of its own.
 */
export const projectAyme = (
  projectDir: string,
  aymeVersion: string
): Effect.Effect<ProjectAyme, SessionStartError> =>
  Effect.suspend(() => {
    const refuse = (sentence: string) =>
      Effect.fail(new SessionStartError(sentence));
    const folder = installedAyme(projectDir);
    if (folder === undefined)
      return refuse(
        `No @ayme-dev/ayme is installed in ${projectDir}. ayme runs the project's Page Objects with the project's own @ayme-dev/ayme: install version ${aymeVersion} there, for example with ${install(aymeVersion)}.`
      );
    let manifest: Manifest;
    try {
      manifest = JSON.parse(
        readFileSync(join(folder, "package.json"), "utf8")
      ) as Manifest;
    } catch (cause) {
      return refuse(
        `The package.json of the @ayme-dev/ayme at ${folder} is not JSON (${(cause as Error).message}). Install @ayme-dev/ayme ${aymeVersion} again, for example with ${install(aymeVersion)}.`
      );
    }
    if (manifest.version !== aymeVersion) {
      const has =
        manifest.version === undefined
          ? "an @ayme-dev/ayme that states no version"
          : `@ayme-dev/ayme ${manifest.version}`;
      return refuse(
        `${projectDir} has ${has}. This ayme, ${aymeVersion}, runs Page Objects only with @ayme-dev/ayme ${aymeVersion}, which is released with it: install that version, for example with ${install(aymeVersion)}.`
      );
    }
    const files: Record<string, string> = {};
    for (const subpath of ["./compiler", "./playwright"]) {
      const file = entryFile(folder, manifest, subpath);
      if (file === undefined)
        return refuse(
          `The @ayme-dev/ayme at ${folder} has no ${subpath} entry, which ayme runs Page Objects with. Install @ayme-dev/ayme ${aymeVersion} again, for example with ${install(aymeVersion)}.`
        );
      files[subpath] = file;
    }
    const entry = join(projectDir, ENTRY);
    if (!existsSync(entry))
      return refuse(
        `${projectDir} has no ayme/page-objects.ts. A Session runs the Page Objects that file lists: its default export is an array of the project's Page Object classes.`
      );
    return Effect.succeed({
      entry,
      compiler: files["./compiler"]!,
      nodeHost: files["./playwright"]!,
    });
  });
