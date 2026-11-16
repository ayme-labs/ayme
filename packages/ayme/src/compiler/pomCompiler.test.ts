import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createPomCompiler } from "./index";
import { diagnosticsOf, positionOf } from "./pomCompileError.testSupport";

// Appended to what the transform generates, to fail its transpile alone.
const generated = vi.hoisted(() => ({ suffix: "" }));
vi.mock("./transformPomModule", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("./transformPomModule")>();
  return {
    ...original,
    createPomTransform: (
      ...args: Parameters<typeof original.createPomTransform>
    ) => {
      const transform = original.createPomTransform(...args);
      return (...transformArgs: Parameters<typeof transform>) => {
        const transformed = transform(...transformArgs);
        return (
          transformed && {
            ...transformed,
            code: transformed.code + generated.suffix,
          }
        );
      };
    },
  };
});

// Each test builds TypeScript Programs, which run several times slower on CI
// while the browser suites and the packed-consumer test run beside them.
vi.setConfig({ testTimeout: 15_000 });

const fixture = (name: string) =>
  fileURLToPath(new URL(`./fixtures/${name}.ts`, import.meta.url));
const source = (fileName: string) => fs.readFileSync(fileName, "utf8");
const tsconfigPath = fileURLToPath(
  new URL("./fixtures/tsconfig.json", import.meta.url)
);

describe("createPomCompiler", () => {
  it("says whether Ayme is in the build and why", () => {
    expect(createPomCompiler().includeLine).toBe(
      "[ayme] Ayme is not in this build: include is not set."
    );
    expect(createPomCompiler({ include: false }).includeLine).toBe(
      "[ayme] Ayme is not in this build: include is false."
    );
    expect(createPomCompiler({ include: true }).includeLine).toBe(
      "[ayme] Ayme is in this build: include is true."
    );
  });

  it("refuses an include that is not a boolean", () => {
    expect(() =>
      createPomCompiler({ include: "yes" as unknown as boolean })
    ).toThrow(new TypeError("include must be a boolean"));
  });

  it("compiles a Page Object Model to TypeScript that registers it, and names the files it read", () => {
    const fileName = fixture("twoPagesPom");
    const compiled = createPomCompiler({ include: true, tsconfigPath }).compile(
      fileName,
      source(fileName),
      { emit: "ts" }
    );

    expect(compiled?.code).toContain(
      "import { registerCompiledPom } from '@ayme-dev/ayme/internal';"
    );
    expect(compiled?.code).toMatch(/registerCompiledPom\(\w+, \{/);
    expect(compiled?.dependencies).toContain(fileName);
  });

  it("compiles to JavaScript when asked", () => {
    const fileName = fixture("twoPagesPom");
    const compiled = createPomCompiler({ include: true, tsconfigPath }).compile(
      fileName,
      source(fileName),
      { emit: "js" }
    );

    expect(compiled?.code).toContain("registerCompiledPom(");
    expect(compiled?.code).not.toMatch(/:\s*Locator\b/);
    expect(compiled?.code).not.toMatch(/^\s*@ayme/m);
  });

  it("compiles a Page Object Model to its stand-in in a build without Ayme", () => {
    const fileName = fixture("twoPagesPom");
    const compiled = createPomCompiler({ tsconfigPath }).compile(
      fileName,
      source(fileName),
      { emit: "ts" }
    );

    expect(compiled?.code).toContain(
      "import { absentPageObject } from '@ayme-dev/ayme/absent';"
    );
    expect(compiled?.code).not.toContain("registerCompiledPom");
  });

  it("locates an unsupported parameter where it is declared in the source", () => {
    const fileName = fixture("unsupportedShapes/callablePom");
    expect(
      diagnosticsOf(() =>
        createPomCompiler({ include: true, tsconfigPath }).compile(
          fileName,
          source(fileName),
          { emit: "js" }
        )
      )
    ).toEqual([
      {
        text: `Unsupported Page Object Tool input type for CallablePom.run(callback): () => void. Compiled with ${tsconfigPath}.`,
        file: fileName,
        ...positionOf(fileName, "callback:"),
      },
    ]);
  });

  it("locates an unsupported parameter of an imported Child in the Child's file", () => {
    const page = fixture("importedUnsupportedChild/page");
    const child = fixture("importedUnsupportedChild/child");
    expect(
      diagnosticsOf(() =>
        createPomCompiler({ include: true, tsconfigPath }).compile(
          page,
          source(page),
          { emit: "js" }
        )
      )
    ).toEqual([
      {
        text: `Unsupported Page Object Tool input type for Scheduler.schedule(at): Date. Compiled with ${tsconfigPath}.`,
        file: child,
        ...positionOf(child, "at: Date"),
      },
    ]);
  });

  it("locates a syntax error where it is in the source, not in the compiled module", () => {
    const fileName = fixture("twoPagesPom");
    const broken = source(fileName).replace(
      "return new ResultsPage();",
      "return new ResultsPage(;"
    );

    const thrown = diagnosticsOf(() =>
      createPomCompiler({ include: true, tsconfigPath }).compile(
        fileName,
        broken,
        { emit: "js" }
      )
    );

    expect(thrown).toEqual([
      {
        text: "')' expected.",
        file: fileName,
        line: 16,
        column: 28,
      },
    ]);
  });

  it("names only the file of an error in code it generated", () => {
    const fileName = fixture("twoPagesPom");
    generated.suffix = "\nlet generated = ;\n";
    try {
      expect(
        diagnosticsOf(() =>
          createPomCompiler({ include: true, tsconfigPath }).compile(
            fileName,
            source(fileName),
            { emit: "js" }
          )
        )
      ).toEqual([{ text: "Expression expected.", file: fileName }]);
    } finally {
      generated.suffix = "";
    }
  });

  it("leaves a module that declares no Page Object Model alone", () => {
    expect(
      createPomCompiler({ include: true }).compile(
        "/project/src/page.ts",
        "export const page = 1;\n",
        { emit: "js" }
      )
    ).toBeNull();
  });

  it("transpiles any module to JavaScript", () => {
    expect(
      createPomCompiler().transpile(
        "/project/src/page.ts",
        "export const page: number = 1;\n"
      )
    ).toBe("export const page = 1;\n");
  });

  it("names the absent entry a build without Ayme resolves a specifier to", () => {
    const compiler = createPomCompiler();
    expect(compiler.absentEntry("@ayme-dev/ayme")).toBe(
      "@ayme-dev/ayme/absent"
    );
    expect(compiler.absentEntry("@ayme-dev/vue")).toBe("@ayme-dev/vue/absent");
    expect(compiler.absentEntry("@ayme-dev/mcp")).toBeUndefined();
  });

  it("names the import a compiled module adds", () => {
    expect(createPomCompiler({ include: true }).injectedImport).toBe(
      "@ayme-dev/ayme/internal"
    );
    expect(createPomCompiler().injectedImport).toBe("@ayme-dev/ayme/absent");
  });

  it("hands each file's methods that are not tools to onSkipped", () => {
    const fileName = fixture("annotatedChildrenPom");
    const onSkipped = vi.fn();
    createPomCompiler({ include: true, tsconfigPath, onSkipped }).compile(
      fileName,
      source(fileName),
      { emit: "ts" }
    );

    expect(onSkipped).toHaveBeenCalledWith(fileName, expect.any(Array));
  });

  it("derives a file's manifests", () => {
    const manifests = createPomCompiler({ tsconfigPath }).derivePomManifests(
      fixture("twoPagesPom")
    );

    expect(manifests.map((manifest) => manifest.className)).toContain(
      "SearchPage"
    );
  });

  describe("across edits", () => {
    let project: string | undefined;
    afterEach(() => {
      if (project) fs.rmSync(project, { recursive: true, force: true });
      project = undefined;
    });

    // Inside the fixtures, so `@ayme-dev/ayme` resolves as in a project.
    function writeProject(action: string) {
      project ??= fs.mkdtempSync(
        fileURLToPath(new URL("./fixtures/edits-", import.meta.url))
      );
      fs.writeFileSync(
        path.join(project, "base.ts"),
        `import { ayme } from "@ayme-dev/ayme";\n\n@ayme\nexport class Base {\n  @ayme.action\n  async ${action}(): Promise<void> {}\n}\n`
      );
      const page = path.join(project, "page.ts");
      fs.writeFileSync(
        page,
        'import { ayme } from "@ayme-dev/ayme";\nimport { Base } from "./base";\n\n@ayme\nexport class Page extends Base {}\n'
      );
      return page;
    }

    it("reads an edited dependency only after invalidate", () => {
      const page = writeProject("save");
      const compiler = createPomCompiler({ include: true, tsconfigPath });
      const compile = () =>
        compiler.compile(page, source(page), { emit: "ts" })?.code;
      expect(compile()).toContain('"toolName":"Page.save"');

      writeProject("publish");
      expect(compile()).toContain('"toolName":"Page.save"');

      compiler.invalidate();
      expect(compile()).toContain('"toolName":"Page.publish"');
    });
  });
});
