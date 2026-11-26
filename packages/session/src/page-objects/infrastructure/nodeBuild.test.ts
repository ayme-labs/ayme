import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Effect } from "effect";
import { afterEach, expect, it, onTestFinished, vi } from "vitest";

import { PageObjectsBuild } from "../../session/application";
import type { NodePageObjects } from "./nodeBuild";
import { projectPageObjects } from "./nodeBuild";

afterEach(() => void vi.unstubAllEnvs());

/** A folder of the test's own, outside the repository, so no
 * @ayme-dev/ayme resolves from above it. */
async function folder(name: string): Promise<string> {
  const made = await realpath(await mkdtemp(join(tmpdir(), `ayme-${name}-`)));
  onTestFinished(() => rm(made, { recursive: true, force: true }));
  return made;
}

/**
 * Installs a stand-in for @ayme-dev/ayme in `root`. Its compiler compiles a
 * module that marks a class `@pom`: the class registers with the copy the
 * compiled module imports, as the real compiler's output does, and every
 * other module is left to esbuild. A module that says `// broken` does not
 * compile.
 */
async function installAyme(root: string): Promise<string> {
  return aymePackage(join(root, "node_modules", "@ayme-dev", "ayme"));
}

/** Writes the stand-in for @ayme-dev/ayme into the folder `installed`. */
async function aymePackage(installed: string): Promise<string> {
  await mkdir(installed, { recursive: true });
  const files = {
    "package.json": JSON.stringify({
      name: "@ayme-dev/ayme",
      version: "0.3.0",
      type: "module",
      exports: {
        "./compiler": "./compiler.mjs",
        "./internal": "./internal.mjs",
        "./playwright": "./playwright.mjs",
      },
    }),
    "internal.mjs":
      "export const registered = [];\nexport const registerCompiledPom = (pom) => registered.push(pom);\n",
    "playwright.mjs": "export {};\n",
    "compiler.mjs": `
export class PomCompileError extends Error {
  constructor(diagnostics) {
    super("The module did not compile.");
    this.diagnostics = diagnostics;
  }
}
export const createPomCompiler = () => ({
  compile(fileName, source) {
    if (source.includes("// broken"))
      throw new PomCompileError([{ text: "This Page Object does not compile." }]);
    const pom = /@pom\\s+export class (\\w+)/.exec(source);
    if (!pom) return null;
    return {
      code: 'import { registerCompiledPom } from "@ayme-dev/ayme/internal";\\n' +
        source.replace("@pom", "") +
        "\\nregisterCompiledPom(" + pom[1] + ");\\n",
    };
  },
});
`,
  };
  for (const [name, text] of Object.entries(files))
    await writeFile(join(installed, name), text);
  return installed;
}

/** Writes `files` into `root`, each at its path. */
async function write(root: string, files: Record<string, string>) {
  for (const [name, text] of Object.entries(files)) {
    await mkdir(join(root, name, ".."), { recursive: true });
    await writeFile(join(root, name), text);
  }
}

/** A project with @ayme-dev/ayme installed and `files` in it. */
async function project(files: Record<string, string>) {
  const dir = await folder("project");
  const installed = await installAyme(dir);
  await write(dir, files);
  return { dir, installed };
}

const build = (projectDir: string) =>
  Effect.runPromise(
    Effect.scoped(
      PageObjectsBuild.use(({ build }) => build).pipe(
        Effect.provide(projectPageObjects(projectDir, "0.3.0"))
      )
    )
  ) as Promise<NodePageObjects>;

const refusal = (projectDir: string) =>
  Effect.runPromise(
    Effect.scoped(
      PageObjectsBuild.use(({ build }) => Effect.flip(build)).pipe(
        Effect.provide(projectPageObjects(projectDir, "0.3.0"))
      )
    )
  ).then((error) => error.message);

/** The classes registered with the copy of @ayme-dev/ayme at `installed`. */
const registeredWith = async (installed: string) =>
  (
    (await import(pathToFileURL(join(installed, "internal.mjs")).href)) as {
      registered: unknown[];
    }
  ).registered;

const BASKET = "@pom\nexport class Basket {}\n";

it("builds the entry with the project's compiler, and loads the classes it lists, registered with the project's @ayme-dev/ayme", async () => {
  const { dir, installed } = await project({
    "ayme/page-objects.ts":
      'import { Basket } from "./pom/Basket";\nexport default [Basket];\n',
    "ayme/pom/Basket.ts": BASKET,
  });

  const built = await build(dir);

  expect(built.classes).toHaveLength(1);
  expect(built.nodeHost).toBe(join(installed, "playwright.mjs"));
  expect(await registeredWith(installed)).toEqual(built.classes);
});

it("leaves an @ayme-dev/ayme linked into node_modules from elsewhere outside the build, as pnpm and npm link install it", async () => {
  const dir = await folder("project");
  // A workspace package, as a monorepo keeps it: no node_modules in its
  // path.
  const linked = await aymePackage(join(await folder("workspace"), "ayme"));
  await mkdir(join(dir, "node_modules", "@ayme-dev"), { recursive: true });
  await symlink(linked, join(dir, "node_modules", "@ayme-dev", "ayme"));
  await write(dir, {
    "ayme/page-objects.ts":
      'import { Basket } from "./pom/Basket";\nexport default [Basket];\n',
    "ayme/pom/Basket.ts": BASKET,
  });

  const built = await build(dir);

  expect(await registeredWith(linked)).toEqual(built.classes);
});

it("compiles a model the project imports through a tsconfig path alias, which is the project's own source", async () => {
  const { dir, installed } = await project({
    "ayme/tsconfig.json": JSON.stringify({
      compilerOptions: { paths: { "@shop/*": ["./pom/*"] } },
    }),
    "ayme/page-objects.ts":
      'import { Basket } from "@shop/Basket";\nexport default [Basket];\n',
    "ayme/pom/Basket.ts": BASKET,
  });

  const built = await build(dir);

  expect(await registeredWith(installed)).toEqual(built.classes);
});

it("registers a model in a linked folder with its own install with the project's @ayme-dev/ayme, which runs it", async () => {
  const { dir, installed } = await project({
    "ayme/page-objects.ts":
      'import { Basket } from "./shared/Basket";\nexport default [Basket];\n',
  });
  const elsewhere = await folder("linked");
  const theirs = await installAyme(elsewhere);
  await write(elsewhere, { "shared/Basket.ts": BASKET });
  await symlink(join(elsewhere, "shared"), join(dir, "ayme", "shared"));

  const built = await build(dir);

  expect(await registeredWith(installed)).toEqual(built.classes);
  expect(await registeredWith(theirs)).toEqual([]);
});

it("a module that does not parse fails the build, naming the entry and the file", async () => {
  const { dir } = await project({
    "ayme/page-objects.ts":
      'import { Basket } from "./pom/Basket";\nexport default [Basket];\n',
    "ayme/pom/Basket.ts": "export class Basket {\n  read( {\n}\n",
  });

  const message = await refusal(dir);

  expect(message).toMatch(
    `The Page Objects of ${join(dir, "ayme", "page-objects.ts")} did not build:\n`
  );
  expect(message).toContain("ayme/pom/Basket.ts:4:0:");
});

it("a model that does not compile fails the build with the compiler's diagnostic at the model", async () => {
  const { dir } = await project({
    "ayme/page-objects.ts":
      'import { Basket } from "./pom/Basket";\nexport default [Basket];\n',
    "ayme/pom/Basket.ts": `// broken\n${BASKET}`,
  });

  const message = await refusal(dir);

  expect(message).toContain("This Page Object does not compile.");
  expect(message).toContain("ayme/pom/Basket.ts:0:0:");
});

it("an entry whose default export lists no classes fails the start, saying what to export", async () => {
  const { dir } = await project({
    "ayme/page-objects.ts": 'export default ["Basket"];\n',
  });

  expect(await refusal(dir)).toContain(
    "is not an array of Page Object classes"
  );
});

it("a built module that cannot be written to a temporary file fails the start, saying where", async () => {
  const { dir } = await project({
    "ayme/page-objects.ts": "export default [];\n",
  });
  const missing = join(dir, "no-such-folder");
  vi.stubEnv("TMPDIR", missing);

  expect(await refusal(dir)).toMatch(
    new RegExp(
      `^ayme could not write the built Page Objects of ${join(dir, "ayme", "page-objects.ts")} to a file in ${missing}: .*ENOENT`
    )
  );
});
