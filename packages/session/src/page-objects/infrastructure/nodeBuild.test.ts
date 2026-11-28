import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Effect, Fiber, Stream } from "effect";
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
 * other module is left to esbuild. A module that says `// types from
 * <file>` reads the types of its tools from that file, which esbuild never
 * loads, as an `import type` does. A module that says `// broken`, or
 * whose types file does, does not compile.
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
      },
    }),
    "internal.mjs":
      "export const registered = [];\nexport const registerCompiledPom = (pom) => registered.push(pom);\n",
    "compiler.mjs": `
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
export class PomCompileError extends Error {
  constructor(diagnostics) {
    super("The module did not compile.");
    this.diagnostics = diagnostics;
  }
}
export const createPomCompiler = () => ({
  compile(fileName, source, { onDependencies } = {}) {
    const types = [...source.matchAll(/[/][/] types from ([^ \\n]+)/g)].map(
      (match) => join(dirname(fileName), match[1])
    );
    onDependencies?.(types);
    if (
      [source, ...types.map((file) => readFileSync(file, "utf8"))].some(
        (text) => text.includes("// broken")
      )
    )
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

const refused = (projectDir: string) =>
  Effect.runPromise(
    Effect.scoped(
      PageObjectsBuild.use(({ build }) => Effect.flip(build)).pipe(
        Effect.provide(projectPageObjects(projectDir, "0.3.0"))
      )
    )
  );
const refusal = (projectDir: string) =>
  refused(projectDir).then((error) => error.message);

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
  expect(built.nodeHost).toBe(join(installed, "internal.mjs"));
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

  expect(await refusal(dir)).toBe(
    `The Page Objects of ${join(dir, "ayme", "page-objects.ts")} did not build:\n✘ [ERROR] Expected ")" but found end of file\n\n    ayme/pom/Basket.ts:4:0:\n      4 │ \n        │ ^\n        ╵ )`
  );
});

it("a model that does not compile fails the build with the compiler's diagnostic at the model", async () => {
  const { dir } = await project({
    "ayme/page-objects.ts":
      'import { Basket } from "./pom/Basket";\nexport default [Basket];\n',
    "ayme/pom/Basket.ts": `// broken\n${BASKET}`,
  });

  const error = await refused(dir);

  expect(error.message).toContain("This Page Object does not compile.");
  expect(error.message).toContain("ayme/pom/Basket.ts:0:0:");
  expect(error.first).toBe(
    "ayme/pom/Basket.ts: This Page Object does not compile."
  );
});

it("a project without TypeScript fails the start, saying to install it, since the compiler runs on the project's own TypeScript", async () => {
  const { dir, installed } = await project({
    "ayme/page-objects.ts": "export default [];\n",
  });
  // The real compiler imports the project's TypeScript as it loads.
  await writeFile(
    join(installed, "compiler.mjs"),
    'import ts from "typescript";\nexport const createPomCompiler = ts;\n'
  );

  expect(await refusal(dir)).toMatch(
    /^The Page Object compiler of the project's @ayme-dev\/ayme, .+, did not load: Cannot find package 'typescript' .+\. The compiler runs on the project's own TypeScript: install it, for example with "npm install -D typescript"\.$/
  );
});

it("a compiler that does not load for another reason fails the start with that reason alone", async () => {
  const { dir, installed } = await project({
    "ayme/page-objects.ts": "export default [];\n",
  });
  await writeFile(
    join(installed, "compiler.mjs"),
    'throw new Error("The compiler is broken.");\n'
  );

  expect(await refusal(dir)).toBe(
    `The Page Object compiler of the project's @ayme-dev/ayme, ${join(installed, "compiler.mjs")}, did not load: The compiler is broken.`
  );
});

it("an entry that throws as it loads fails the start, naming the entry and what it threw", async () => {
  const { dir } = await project({
    "ayme/page-objects.ts":
      'throw new Error("No basket here.");\nexport default [];\n',
  });

  expect(await refusal(dir)).toBe(
    `The Page Objects of ${join(dir, "ayme", "page-objects.ts")} did not load: No basket here.`
  );
});

it("a compiler that throws an error of its own on a model, not a compile error, fails the build with that error", async () => {
  const { dir, installed } = await project({
    "ayme/page-objects.ts":
      'import { Basket } from "./pom/Basket";\nexport default [Basket];\n',
    "ayme/pom/Basket.ts": BASKET,
  });
  await writeFile(
    join(installed, "compiler.mjs"),
    `export class PomCompileError extends Error {}
export const createPomCompiler = () => ({
  compile() {
    throw new Error("The compiler crashed.");
  },
});
`
  );

  expect(await refusal(dir)).toContain("The compiler crashed.");
});

it("a package the Page Objects import is the copy installed in a folder above them, which Node loads, and a Node builtin is Node's own", async () => {
  const { dir, installed } = await project({
    "ayme/page-objects.ts":
      'import { Basket } from "./pom/Basket";\nexport default [Basket];\n',
    "ayme/pom/Basket.ts": `import { basename } from "node:path";\nimport { seen } from "shop-data";\n${BASKET}seen.push(Basket, basename("/a/b"));\n`,
  });
  const shopData = join(dir, "node_modules", "shop-data");
  await write(shopData, {
    "package.json": JSON.stringify({
      name: "shop-data",
      type: "module",
      exports: "./index.mjs",
    }),
    "index.mjs": "export const seen = [];\n",
  });

  const built = await build(dir);

  const { seen } = (await import(
    pathToFileURL(join(shopData, "index.mjs")).href
  )) as { seen: unknown[] };
  expect(seen).toEqual([...built.classes, "b"]);
  expect(await registeredWith(installed)).toEqual(built.classes);
});

it("a path alias under the scope of an installed package names the project's own source, which is compiled", async () => {
  const { dir, installed } = await project({
    "ayme/tsconfig.json": JSON.stringify({
      compilerOptions: { paths: { "@ayme-dev/shop/*": ["./pom/*"] } },
    }),
    "ayme/page-objects.ts":
      'import { Basket } from "@ayme-dev/shop/Basket";\nexport default [Basket];\n',
    "ayme/pom/Basket.ts": BASKET,
  });

  const built = await build(dir);

  expect(await registeredWith(installed)).toEqual(built.classes);
});

it("an import of a package that is not installed fails the build, naming it", async () => {
  const { dir } = await project({
    "ayme/page-objects.ts":
      'import { seen } from "shop-data";\nexport default [seen];\n',
  });

  expect(await refused(dir)).toMatchObject({
    first: `ayme/page-objects.ts:1:22: Could not resolve "shop-data"`,
  });
});

it("a build leaves no file behind in the temporary folder it loads the built module from", async () => {
  const { dir } = await project({
    "ayme/page-objects.ts":
      'import { Basket } from "./pom/Basket";\nexport default [Basket];\n',
    "ayme/pom/Basket.ts": BASKET,
  });
  const temporary = await folder("tmp");
  vi.stubEnv("TMPDIR", temporary);

  await build(dir);

  expect(await readdir(temporary)).toEqual([]);
});

it("an entry whose default export lists no classes fails the start, saying what to export", async () => {
  const { dir } = await project({
    "ayme/page-objects.ts": 'export default ["Basket"];\n',
  });

  expect(await refusal(dir)).toContain(
    "is not an array of Page Object classes"
  );
});

it("an entry that lists two different classes of one name fails the build, since ayme tells Page Object classes apart by name", async () => {
  const { dir } = await project({
    "ayme/page-objects.ts":
      'import { Basket } from "./pom/Basket";\nimport { Basket as Cart } from "./pom/cart/Basket";\nexport default [Basket, Cart];\n',
    "ayme/pom/Basket.ts": BASKET,
    "ayme/pom/cart/Basket.ts": BASKET,
  });

  expect(await refusal(dir)).toBe(
    `The default export of ${join(dir, "ayme", "page-objects.ts")} lists two different classes named Basket. ayme tells Page Object classes apart by name: rename one of them.`
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

it("tells of an edit to a file the last build read, and a build after it loads the edited classes", async () => {
  const { dir } = await project({
    "ayme/page-objects.ts":
      'import { Basket } from "./pom/Basket";\nexport default [Basket];\n',
    "ayme/pom/Basket.ts": BASKET,
  });
  const [before, after] = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const { build, edits } = yield* PageObjectsBuild;
        const first = (yield* build) as NodePageObjects;
        const edited = yield* Effect.forkScoped(Stream.runHead(edits));
        yield* Effect.promise(() =>
          write(dir, { "ayme/pom/Basket.ts": `${BASKET}// edited\n` })
        );
        yield* Fiber.join(edited);
        return [first, (yield* build) as NodePageObjects];
      }).pipe(Effect.provide(projectPageObjects(dir, "0.3.0")))
    )
  );
  expect(after.classes).toHaveLength(1);
  expect(after.classes[0]).not.toBe(before.classes[0]);
});

/**
 * Builds the project in `dir` once, then, for each step, makes the change
 * `step` makes and waits for the edit it causes, then builds again; what
 * each build gave, the error it failed with or its classes. A change that
 * causes no edit within 5 s fails.
 */
async function buildsAcross(
  dir: string,
  steps: readonly (() => Promise<unknown>)[]
): Promise<(string | readonly unknown[])[]> {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const { build, edits } = yield* PageObjectsBuild;
        const outcome = build.pipe(
          Effect.match({
            onSuccess: (built) => (built as NodePageObjects).classes,
            onFailure: (error) => error.message,
          })
        );
        const outcomes = [yield* outcome];
        for (const step of steps) {
          const edited = yield* Effect.forkScoped(
            Stream.runHead(edits).pipe(Effect.timeoutOption(5000))
          );
          yield* Effect.promise(step);
          const heard = yield* Fiber.join(edited);
          if (heard._tag === "None")
            return yield* Effect.die(new Error("No edit was told."));
          outcomes.push(yield* outcome);
        }
        return outcomes;
      }).pipe(Effect.provide(projectPageObjects(dir, "0.3.0")))
    )
  );
}

it("an entry that goes away for a moment, as on a branch switch, is still watched, and its return is an edit", async () => {
  const { dir } = await project({
    "ayme/page-objects.ts":
      'import { Basket } from "./pom/Basket";\nexport default [Basket];\n',
    "ayme/pom/Basket.ts": BASKET,
  });
  const entry = join(dir, "ayme", "page-objects.ts");
  const text = await readFile(entry, "utf8");

  const outcomes = await buildsAcross(dir, [
    () => rm(entry),
    () => writeFile(entry, text),
  ]);

  expect(outcomes[1]).toContain("has no ayme/page-objects.ts");
  expect(outcomes[2]).toHaveLength(1);
}, 15_000);

it("a failed import is repaired by adding the missing file alone, in a folder no build read from", async () => {
  const { dir } = await project({
    "ayme/page-objects.ts":
      'import { Basket } from "./pom/Basket";\nexport default [Basket];\n',
    "ayme/pom/Basket.ts": BASKET,
    "ayme/pom/cart/README.md": "The cart's Page Objects.\n",
  });

  const outcomes = await buildsAcross(dir, [
    () =>
      write(dir, {
        "ayme/pom/Basket.ts": `import { Cart } from "./cart/Cart";\n${BASKET}export const cart = Cart;\n`,
      }),
    () => write(dir, { "ayme/pom/cart/Cart.ts": "export class Cart {}\n" }),
  ]);

  expect(outcomes[1]).toContain('Could not resolve "./cart/Cart"');
  expect(outcomes[2]).toHaveLength(1);
}, 15_000);

it("an edit to a file only the Page Object compiler reads, as an import type, is an edit, and so is its repair", async () => {
  const { dir } = await project({
    "ayme/page-objects.ts":
      'import { Basket } from "./pom/Basket";\nexport default [Basket];\n',
    "ayme/pom/Basket.ts": `// types from ./item.ts\n${BASKET}`,
    "ayme/pom/item.ts": "export type Item = string;\n",
  });

  const outcomes = await buildsAcross(dir, [
    () => write(dir, { "ayme/pom/item.ts": "// broken\n" }),
    () => write(dir, { "ayme/pom/item.ts": "export type Item = number;\n" }),
  ]);

  expect(outcomes[1]).toContain("This Page Object does not compile.");
  expect(outcomes[2]).toHaveLength(1);
}, 15_000);

it("the watch belongs to the build's lifetime, not to each build: a build whose own scope closed still has its edits told", async () => {
  const { dir } = await project({
    "ayme/page-objects.ts":
      'import { Basket } from "./pom/Basket";\nexport default [Basket];\n',
    "ayme/pom/Basket.ts": BASKET,
  });
  const told = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const { build, edits } = yield* PageObjectsBuild;
        yield* Effect.scoped(build);
        const edited = yield* Effect.forkScoped(
          Stream.runHead(edits).pipe(Effect.timeoutOption(5000))
        );
        yield* Effect.promise(() =>
          write(dir, { "ayme/pom/Basket.ts": `${BASKET}// edited\n` })
        );
        return yield* Fiber.join(edited);
      }).pipe(Effect.provide(projectPageObjects(dir, "0.3.0")))
    )
  );
  expect(told._tag).toBe("Some");
}, 15_000);

it("an edit to a model the entry reaches through a tsconfig path alias is an edit", async () => {
  const { dir } = await project({
    "ayme/tsconfig.json": JSON.stringify({
      compilerOptions: { paths: { "@shop/*": ["./pom/*"] } },
    }),
    "ayme/page-objects.ts":
      'import { Basket } from "@shop/Basket";\nexport default [Basket];\n',
    "ayme/pom/Basket.ts": BASKET,
  });

  const outcomes = await buildsAcross(dir, [
    () => write(dir, { "ayme/pom/Basket.ts": `// broken\n${BASKET}` }),
  ]);

  expect(outcomes[1]).toContain("This Page Object does not compile.");
}, 15_000);

it.each([
  "cart/Cart.tsx",
  "cart/Cart.jsx",
  "cart/Cart.js",
  "cart/Cart.json",
  "cart/Cart/index.ts",
])(
  "a failed import is repaired by adding %s, a file esbuild resolves the import to",
  async (added) => {
    const { dir } = await project({
      "ayme/page-objects.ts":
        'import { Basket } from "./pom/Basket";\nexport default [Basket];\n',
      "ayme/pom/Basket.ts": `import * as cart from "./cart/Cart";\n${BASKET}export const items = cart;\n`,
      "ayme/pom/cart/README.md": "The cart's Page Objects.\n",
    });

    const outcomes = await buildsAcross(dir, [
      () =>
        write(dir, {
          [`ayme/pom/${added}`]: added.endsWith(".json")
            ? "{}\n"
            : "export const items = [];\n",
        }),
    ]);

    expect(outcomes[0]).toContain('Could not resolve "./cart/Cart"');
    expect(outcomes[1]).toHaveLength(1);
  },
  15_000
);

it("a write that leaves every file as the last build read it is no edit", async () => {
  const { dir } = await project({
    "ayme/page-objects.ts":
      'import { Basket } from "./pom/Basket";\nexport default [Basket];\n',
    "ayme/pom/Basket.ts": BASKET,
  });
  const told = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const { build, edits } = yield* PageObjectsBuild;
        yield* build;
        const edited = yield* Effect.forkScoped(
          Stream.runHead(edits).pipe(Effect.timeoutOption(600))
        );
        yield* Effect.promise(() =>
          write(dir, { "ayme/pom/Basket.ts": BASKET })
        );
        return yield* Fiber.join(edited);
      }).pipe(Effect.provide(projectPageObjects(dir, "0.3.0")))
    )
  );

  expect(told._tag).toBe("None");
});
