import assert from "node:assert/strict";
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

import { expect, it, onTestFinished, vi } from "vitest";

import { buildErrorLine } from "../domain/buildFailure";
import {
  watchPageObjects,
  type PageObjectsBuildEvent,
  type PomCompilerEntry,
} from "./pageObjectsBundler";

type Compiler = ReturnType<PomCompilerEntry["createPomCompiler"]>;
type Diagnostics = PomCompilerEntry["PomCompileError"] extends new (
  ...args: never[]
) => { diagnostics: infer T }
  ? T
  : never;
type Outcome = Exclude<PageObjectsBuildEvent, { kind: "building" }>;

class PomCompileError extends Error {
  constructor(readonly diagnostics: Diagnostics) {
    super(diagnostics.map(({ text }) => text).join("\n"));
  }
}

async function fixture() {
  const folder = await realpath(await mkdtemp(join(tmpdir(), "ayme-bundle-")));
  let close: (() => Promise<void>) | undefined;
  onTestFinished(async () => {
    try {
      await close?.();
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
  const runtime = join(folder, "node_modules", "@ayme-dev", "ayme");
  await mkdir(runtime, { recursive: true });
  await writeFile(
    join(runtime, "index.js"),
    'export const runtime = "project runtime";'
  );
  return {
    folder,
    async write(name: string, source: string) {
      const file = join(folder, name);
      await writeFile(file, source);
      return file;
    },
    async watch(entry: string, compile: Compiler["compile"] = () => null) {
      const outcomes: Outcome[] = [];
      const invalidate = vi.fn();
      const createPomCompiler = vi.fn(() => ({ compile, invalidate }));
      close = await watchPageObjects(
        entry,
        { createPomCompiler, PomCompileError },
        (event) => {
          if (event.kind !== "building") outcomes.push(event);
        }
      );
      expect(createPomCompiler).toHaveBeenCalledExactlyOnceWith({
        include: true,
      });
      return {
        invalidate,
        async outcome(number = 1) {
          await expect
            .poll(() => outcomes.length)
            .toBeGreaterThanOrEqual(number);
          return outcomes[number - 1]!;
        },
      };
    },
  };
}

it("serves the entry and project runtime, compiling only the project's TypeScript and rebuilding when a compiler dependency changes", async () => {
  const { folder, write, watch } = await fixture();
  const entry = await write(
    "entry.ts",
    'import { value } from "other"; export default value;'
  );
  const dependency = await write("compiler-config.txt", "before");
  const other = join(folder, "node_modules", "other");
  await mkdir(other);
  await writeFile(join(other, "package.json"), '{"main":"index.ts"}');
  await writeFile(
    join(other, "index.ts"),
    'export const value: string = "dependency";'
  );
  const compile = vi.fn<Compiler["compile"]>(() => ({
    code: 'import { value } from "other"; export default value + "compiled";',
    dependencies: [dependency],
  }));

  const { outcome, invalidate } = await watch(entry, compile);
  const first = await outcome();
  assert(first.kind === "built");
  expect(first.modules.get("entry.js")).toContain("compiled");
  expect(first.modules.get("entry.js")).toContain("dependency");
  expect(first.modules.get("runtime.js")).toContain("project runtime");
  expect(compile).toHaveBeenCalledExactlyOnceWith(
    entry,
    'import { value } from "other"; export default value;',
    { emit: "js", onDependencies: expect.any(Function) }
  );

  await write("compiler-config.txt", "a different value");
  expect((await outcome(2)).kind).toBe("built");
  expect(invalidate).toHaveBeenCalledTimes(2);
});

it.each([true, false])(
  "reports a thrown compile error against the compiled file and rebuilds after a fix (dependency read: %s)",
  async (readsDependency) => {
    const { write, watch } = await fixture();
    const source = "export default 1;";
    const entry = await write("entry.ts", source);
    const dependency = await write("compiler-config.txt", "before");
    let broken = true;
    const { outcome } = await watch(
      entry,
      (_file, _source, { onDependencies }) => {
        if (!broken) return null;
        if (readsDependency) onDependencies?.([dependency]);
        throw new Error("Could not read TypeScript project configuration");
      }
    );
    const first = await outcome();
    assert(first.kind === "failed");
    expect(first.errors.map(buildErrorLine)).toEqual([
      `${entry}: Could not read TypeScript project configuration`,
    ]);

    broken = false;
    await write(
      readsDependency ? "compiler-config.txt" : "entry.ts",
      "export default 200;"
    );
    expect((await outcome(2)).kind).toBe("built");
  }
);

it("reports compiler diagnostics with the positions they provide, including UTF-8 columns", async () => {
  const { write, watch } = await fixture();
  const entry = await write("entry.ts", "class Page {}");
  const child = await write("Child.ts", "const café = ;\n");
  const { outcome } = await watch(entry, () => {
    throw new PomCompileError([
      {
        text: "Expression expected.",
        file: child,
        line: 1,
        column: 14,
        lineText: "const café = ;",
      },
      { text: "no position", file: child },
      { text: "no file" },
    ]);
  });

  const result = await outcome();
  assert(result.kind === "failed");
  expect(result.errors).toContainEqual({
    text: "Expression expected.",
    location: { file: child, line: 1, column: 14, lineText: "const café = ;" },
  });
  expect(result.errors.map(buildErrorLine).sort()).toEqual(
    [
      `${child}:1:14: Expression expected.`,
      `${child}: no position`,
      `${entry}: no file`,
    ].sort()
  );
});

it.each([
  ["\uFEFFconst value = ;", 15],
  ['export const note = "café ☕ 😀" +;', 34],
] as const)(
  "reports esbuild's own error in %j at the column an editor counts",
  async (source, column) => {
    const { write, watch } = await fixture();
    const entry = await write("entry.ts", source);
    const { outcome } = await watch(entry);
    const result = await outcome();
    assert(result.kind === "failed");
    expect(result.errors.map(buildErrorLine)).toEqual([
      `${entry}:1:${column}: Unexpected ";"`,
    ]);
  }
);

it("omits generated positions for a failed import and reports source positions again once the file stops compiling", async () => {
  const { write, watch } = await fixture();
  const entry = await write("entry.ts", "// pom\nexport const value = 1;");
  const { outcome, invalidate } = await watch(entry, (_file, source) =>
    source.startsWith("// pom")
      ? { code: `\n\n${source}`, dependencies: [] }
      : null
  );
  expect((await outcome()).kind).toBe("built");

  await write("entry.ts", '// pom\nconst é = "😀"; import "./missing";');
  const generated = await outcome(2);
  assert(generated.kind === "failed");
  expect(generated.errors.map(buildErrorLine)).toEqual([
    `${entry}: Could not resolve "./missing"`,
  ]);

  await write("entry.ts", 'import "./missing";');
  const source = await outcome(3);
  assert(source.kind === "failed");
  expect(source.errors.map(buildErrorLine)).toEqual([
    `${entry}:1:8: Could not resolve "./missing"`,
  ]);

  await write("entry.ts", "export const value = 2;");
  const fixed = await outcome(4);
  assert(fixed.kind === "built");
  expect(fixed.modules.get("entry.js")).toContain("=2");
  expect(invalidate).toHaveBeenCalledTimes(4);
});

it("keeps the source position of an error in a file it did not compile, beside one it did", async () => {
  const { write, watch } = await fixture();
  const helper = await write("helper.ts", 'import "./missing";');
  const entry = await write("entry.ts", '// pom\nimport "./helper";');
  const { outcome } = await watch(entry, (_file, source) =>
    source.startsWith("// pom")
      ? { code: `\n\n${source}`, dependencies: [] }
      : null
  );
  const result = await outcome();
  assert(result.kind === "failed");
  expect(result.errors.map(buildErrorLine)).toEqual([
    `${helper}:1:8: Could not resolve "./missing"`,
  ]);
});

it("reports an error esbuild gives no location, such as a missing entry", async () => {
  const { folder, watch } = await fixture();
  const entry = join(folder, "missing.ts");
  const { outcome } = await watch(entry);
  const result = await outcome();
  assert(result.kind === "failed");
  expect(result.errors).toEqual([
    { text: expect.stringContaining("missing.ts"), location: null },
  ]);
});

it("omits generated positions when the working directory is a symlink", async () => {
  const { folder, write, watch } = await fixture();
  const actual = join(folder, "actual");
  const linked = join(folder, "linked");
  await mkdir(actual);
  await symlink(actual, linked, "dir");
  await write("actual/entry.ts", "class Page {}");
  const entry = join(linked, "entry.ts");
  const { outcome } = await watch(entry, () => ({
    code: '\n\nimport "./missing";',
    dependencies: [],
  }));
  const result = await outcome();
  assert(result.kind === "failed");
  expect(result.errors.map(buildErrorLine)).toEqual([
    `${entry}: Could not resolve "./missing"`,
  ]);
});

it.each([false, true])(
  "deduplicates tsconfig diagnostics reported by both compilers (symlink: %s)",
  async (linked) => {
    const { folder, write, watch } = await fixture();
    const source =
      '{\n  "compilerOptions": {\n    "target": "es2022",,\n  }\n}\n';
    const tsconfig = join(folder, "tsconfig.json");
    if (linked) {
      await write("base.json", source);
      await symlink("base.json", tsconfig);
    } else {
      await write("tsconfig.json", source);
    }
    const entry = await write("entry.ts", "class Page {}");
    const text =
      "Could not read TypeScript project configuration: Property assignment expected.";
    const { outcome } = await watch(entry, () => {
      throw new PomCompileError([
        {
          text,
          file: tsconfig,
          line: 3,
          column: 24,
          lineText: '    "target": "es2022",,',
        },
      ]);
    });
    const result = await outcome();
    assert(result.kind === "failed");
    expect(result.errors.map(buildErrorLine)).toEqual([
      `${tsconfig}:3:24: ${text}`,
    ]);
  }
);

it("keeps esbuild and compiler errors on the same line of a source file", async () => {
  const { write, watch } = await fixture();
  const source = 'import "./missing";';
  const other = await write("other.js", source);
  const entry = await write(
    "entry.ts",
    'import "./other.js"; import "./Page";'
  );
  await write("Page.ts", "class Page {}");
  const text = 'Page Object "Page" reaches two different classes named "Row".';
  const { outcome } = await watch(entry, (file) => {
    if (file === entry) return null;
    throw new PomCompileError([
      { text, file: other, line: 1, column: 1, lineText: source },
    ]);
  });
  const result = await outcome();
  assert(result.kind === "failed");
  expect(result.errors.map(buildErrorLine).sort()).toEqual(
    [
      `${other}:1:1: ${text}`,
      `${other}:1:8: Could not resolve "./missing"`,
    ].sort()
  );
});

it("keeps a compiler diagnostic's source position when it names another compiled file", async () => {
  const { write, watch } = await fixture();
  const entry = await write("entry.ts", 'import "./Child"; import "./Page";');
  const child = await write("Child.ts", "export class Child {}");
  await write("Page.ts", "export class Page {}");
  const text =
    "Unsupported Page Object Tool input type for Child.pick(callback): () => void.";
  const { outcome } = await watch(entry, (file) => {
    if (file === entry) return null;
    if (file === child) return { code: "\n\nexport {};", dependencies: [] };
    throw new PomCompileError([
      {
        text,
        file: child,
        line: 8,
        column: 14,
        lineText: "  async pick(callback: () => void) {",
      },
    ]);
  });

  const result = await outcome();
  assert(result.kind === "failed");
  expect(result.errors.map(buildErrorLine)).toEqual([`${child}:8:14: ${text}`]);
});
