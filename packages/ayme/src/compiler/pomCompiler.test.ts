import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createPomCompiler } from "./index";

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

  it("names a syntax error where it is in the source, not in the compiled module", () => {
    const fileName = fixture("twoPagesPom");
    const broken = source(fileName).replace(
      "return new ResultsPage();",
      "return new ResultsPage(;"
    );

    expect(() =>
      createPomCompiler({ include: true, tsconfigPath }).compile(
        fileName,
        broken,
        { emit: "js" }
      )
    ).toThrow(
      new Error(
        `Could not transpile Ayme POM ${fileName}:\n${fileName}:16:28: ')' expected.`
      )
    );
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
