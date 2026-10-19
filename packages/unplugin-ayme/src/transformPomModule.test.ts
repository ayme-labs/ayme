import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

const { createPomProgram } = vi.hoisted(() => ({
  createPomProgram: vi.fn(),
}));

vi.mock("./pomProgram", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./pomProgram")>();
  createPomProgram.mockImplementation(actual.createPomProgram);
  return { ...actual, createPomProgram };
});

import {
  absentEntryFor,
  createPomTransform,
  type PomPrograms,
} from "./transformPomModule";

it("builds one TypeScript program per POM transform", () => {
  const fixturePath = fileURLToPath(
    new URL("./fixtures/annotatedChildrenPom.ts", import.meta.url)
  );
  const source = readFileSync(fixturePath, "utf8");
  const transform = createPomTransform();

  expect(transform(source, fixturePath)).not.toBeNull();
  expect(createPomProgram).toHaveBeenCalledTimes(1);

  expect(transform(source, fixturePath)).not.toBeNull();
  expect(createPomProgram).toHaveBeenCalledTimes(2);
});

describe("with a Program cache", () => {
  const fixture = (name: string) => {
    const fixturePath = fileURLToPath(
      new URL(`./fixtures/${name}.ts`, import.meta.url)
    );
    return [readFileSync(fixturePath, "utf8"), fixturePath] as const;
  };

  it("builds one Program for the modules of one tsconfig project until it is cleared", () => {
    const programs: PomPrograms = new Map();
    const transform = createPomTransform({}, undefined, programs);
    createPomProgram.mockClear();

    expect(transform(...fixture("annotatedChildrenPom"))).not.toBeNull();
    expect(transform(...fixture("twoPagesPom"))).not.toBeNull();
    expect(createPomProgram).toHaveBeenCalledTimes(1);
    expect([...programs.keys()]).toEqual([
      fileURLToPath(new URL("./fixtures/tsconfig.json", import.meta.url)),
    ]);

    programs.clear();
    expect(transform(...fixture("twoPagesPom"))).not.toBeNull();
    expect(createPomProgram).toHaveBeenCalledTimes(2);
  });

  it("drops the cached Program when a transform fails", () => {
    const programs: PomPrograms = new Map();
    const transform = createPomTransform({}, undefined, programs);

    expect(transform(...fixture("annotatedChildrenPom"))).not.toBeNull();
    expect(programs.size).toBe(1);
    expect(() =>
      transform(...fixture("unsupportedShapes/callablePom"))
    ).toThrow("Unsupported Page Object Tool input type");
    expect(programs.size).toBe(0);
  });

  it("compiles a module outside its project's files uncached", () => {
    const programs: PomPrograms = new Map();
    const transform = createPomTransform(
      {
        tsconfigPath: fileURLToPath(
          new URL(
            "./__tests__/fixtures/solutionStyle/tsconfig.app.json",
            import.meta.url
          )
        ),
      },
      undefined,
      programs
    );
    createPomProgram.mockClear();

    expect(transform(...fixture("annotatedChildrenPom"))).not.toBeNull();
    expect(transform(...fixture("annotatedChildrenPom"))).not.toBeNull();
    expect(createPomProgram).toHaveBeenCalledTimes(2);
    expect(programs.size).toBe(0);
  });
});

it("registers an undecorated subclass of a decorated base", () => {
  const fixturePath = fileURLToPath(
    new URL("./fixtures/decoratedBasePom.ts", import.meta.url)
  );
  const code = createPomTransform({ include: true })(
    readFileSync(fixturePath, "utf8"),
    fixturePath
  )?.code;

  expect(code).toContain("registerCompiledPom(BaseMenu, {");
  expect(code).toContain("registerCompiledPom(UserMenu, {");
});

it("builds no program for a module that only imports the main library", () => {
  createPomProgram.mockClear();
  const source =
    'import { createPage } from "@ayme-dev/ayme";\nexport const page = createPage;\n';

  expect(createPomTransform()(source, "/project/src/page.ts")).toBeNull();
  expect(createPomProgram).not.toHaveBeenCalled();
});

describe("a subclass in a module without the decorator", () => {
  const fixture = (name: string) => {
    const fixturePath = fileURLToPath(
      new URL(`./fixtures/crossFile/${name}.ts`, import.meta.url)
    );
    return { fixturePath, source: readFileSync(fixturePath, "utf8") };
  };

  it("registers it when it imports a decorated base directly", () => {
    const { fixturePath, source } = fixture("userMenu");
    expect(source).not.toMatch(/@ayme\b(?!-)/);
    createPomProgram.mockClear();

    const result = createPomTransform({ include: true })(source, fixturePath);

    expect(result).not.toBeNull();
    expect(createPomProgram).toHaveBeenCalledTimes(1);
    expect(result?.code).toContain("registerCompiledPom(UserMenu, {");
    expect(result?.code).toContain('"memberName":"signOutItem"');
    expect(result?.code).toContain('"toolName":"UserMenu.open"');
  });

  it("registers it when it imports a decorated base through a barrel", () => {
    const { fixturePath, source } = fixture("barrelUserMenu");
    expect(source).not.toMatch(/@ayme\b(?!-)/);

    const result = createPomTransform({ include: true })(source, fixturePath);

    expect(result).not.toBeNull();
    expect(result?.code).toContain("registerCompiledPom(BarrelUserMenu, {");
    expect(result?.code).toContain('"toolName":"BarrelUserMenu.open"');
  });

  it("builds no program when its import closure has no decorated module", () => {
    const { fixturePath, source } = fixture("plainSubclass");
    createPomProgram.mockClear();

    expect(createPomTransform()(source, fixturePath)).toBeNull();
    expect(createPomProgram).not.toHaveBeenCalled();
  });

  describe("tsconfig", () => {
    let root: string | undefined;
    afterEach(() => {
      if (root) rmSync(root, { recursive: true, force: true });
      root = undefined;
    });
    const writeProject = (tsconfig?: string) => {
      root = mkdtempSync(join(tmpdir(), "ayme-gate-"));
      if (tsconfig) writeFileSync(join(root, "tsconfig.json"), tsconfig);
      writeFileSync(join(root, "base.ts"), "export class Base {}\n");
      const subclass = join(root, "sub.ts");
      const source =
        'import { Base } from "./base";\nexport class Sub extends Base {}\n';
      writeFileSync(subclass, source);
      return () => createPomTransform()(source, subclass);
    };

    it("returns a subclass untouched when no tsconfig is found", () => {
      expect(writeProject()()).toBeNull();
    });

    it("reports a malformed tsconfig instead of skipping the subclass", () => {
      const transform = writeProject(
        JSON.stringify({ compilerOptions: { moduleResolution: "unknown" } })
      );
      expect(transform).toThrow("Could not read TypeScript project");
    });
  });
});

describe("a solution-style tsconfig", () => {
  const project = fileURLToPath(
    new URL("./__tests__/fixtures/solutionStyle/", import.meta.url)
  );
  const pomPath = join(project, "src/pom/projectsPage.ts");

  it("compiles the Page Object Model with the referenced project that includes it", () => {
    const result = createPomTransform({ include: true })(
      readFileSync(pomPath, "utf8"),
      pomPath
    );

    expect(result?.code).toContain(
      '"name":"kind","optional":false,"schema":{"type":"string","enum":["a","b"]}'
    );
    expect(result?.dependencies).toEqual(
      expect.arrayContaining([
        join(project, "tsconfig.json"),
        join(project, "tsconfig.app.json"),
      ])
    );
  });

  it("names the tsconfig it compiled with when an input type is unsupported", () => {
    const nodeConfig = join(project, "tsconfig.node.json");
    const transform = createPomTransform({
      include: true,
      tsconfigPath: nodeConfig,
    });

    expect(() => transform(readFileSync(pomPath, "utf8"), pomPath)).toThrow(
      `ProjectsPage.probe(kind): Kind. Compiled with ${nodeConfig}.`
    );
  });

  it("names the tsconfig when the unsupported input type is on a Page Object Child's action", () => {
    const nodeConfig = join(project, "tsconfig.node.json");
    const dialogPath = join(project, "src/pom/projectsDialog.ts");
    const transform = createPomTransform({
      include: true,
      tsconfigPath: nodeConfig,
    });

    expect(() =>
      transform(readFileSync(dialogPath, "utf8"), dialogPath)
    ).toThrow(
      // The whole message, so the suffix appears once.
      expect.objectContaining({
        message: `Unsupported Page Object Tool input type for KindPicker.pick(kind): Kind. Compiled with ${nodeConfig}.`,
      })
    );
  });
});

describe("a build without Ayme", () => {
  const fixture = (name: string) => {
    const fixturePath = fileURLToPath(
      new URL(`./fixtures/${name}.ts`, import.meta.url)
    );
    return [readFileSync(fixturePath, "utf8"), fixturePath] as const;
  };
  // Without `include: true`, every build is a build without Ayme.
  const transform = createPomTransform();

  it("compiles each Page Object Model to a stand-in of its name, keeping the rest of the module", () => {
    const code = transform(...fixture("withoutAymePom"))?.code;

    expect(code).toContain(
      "import { absentPageObject } from '@ayme-dev/ayme/absent';"
    );
    expect(code).toContain(
      'export default class ListPage extends absentPageObject("ListPage", {"actions":["addItem"],"properties":["dialog"],"methods":[]}) {}'
    );
    expect(code).toContain('export const ITEM_NAME = fieldLabel("Item name");');
    // The decorator import and the binding only the model used are gone;
    // the one the rest of the module uses stays.
    expect(code).toContain(
      'import { fieldLabel } from "./withoutAymePomLabels";'
    );
    expect(code).not.toContain("listName");
    expect(code).not.toContain('@ayme-dev/ayme"');
    expect(code).not.toContain("registerCompiledPom");
    expect(code).not.toContain("getByLabel");
    expect(code).not.toContain("Add an item to the list.");
    expect(code).not.toContain("@ayme.action");
  });

  it("replaces every Page Object Model of a module, Children included", () => {
    const code = transform(...fixture("twoPagesPom"))?.code;

    expect(code).toContain(
      'export class SearchPage extends absentPageObject("SearchPage", {"actions":["search"],"properties":["searchBox"],"methods":[]}) {}'
    );
    for (const name of ["SearchBox", "ResultsPage", "SettingsPage"])
      expect(code).toContain(
        `export class ${name} extends absentPageObject("${name}", {"actions":[],"properties":[],"methods":[]}) {}`
      );
    expect(code).not.toContain("new ResultsPage()");
  });

  it("lists a Child a method returns as a method", () => {
    const code = transform(...fixture("annotatedChildrenPom"))?.code;

    expect(code).toMatch(
      /class AnnotatedChildrenPom extends absentPageObject\("AnnotatedChildrenPom", \{"actions":\[\],"properties":\["directField","directGetter",.*"methods":\["componentCollection",/
    );
  });

  it("leaves a module without a Page Object Model alone", () => {
    expect(transform("export const x = 1;", "/app/x.ts")).toBeNull();
  });

  it("is the build with Ayme once include is true", () => {
    const code = createPomTransform({ include: true })(
      ...fixture("withoutAymePom")
    )?.code;

    expect(code).toContain("registerCompiledPom(ListPage, {");
    expect(code).toContain("Add an item to the list.");
    expect(code).not.toContain("@ayme-dev/ayme/absent");
  });

  it("rejects an include that is not a boolean", () => {
    expect(() =>
      createPomTransform({ include: "yes" as unknown as boolean })
    ).toThrow(new TypeError("include must be a boolean"));
  });
});

describe("the absent entry of a specifier", () => {
  it("maps the runtime's root and internal entries and the framework packages' roots", () => {
    expect(absentEntryFor("@ayme-dev/ayme")).toBe("@ayme-dev/ayme/absent");
    expect(absentEntryFor("@ayme-dev/ayme/internal")).toBe(
      "@ayme-dev/ayme/absent"
    );
    for (const framework of ["vue", "react", "svelte", "angular"])
      expect(absentEntryFor(`@ayme-dev/${framework}`)).toBe(
        `@ayme-dev/${framework}/absent`
      );
  });

  it("maps nothing else", () => {
    for (const untouched of [
      "@ayme-dev/ayme/server",
      "@ayme-dev/ayme/absent",
      "@ayme-dev/ayme/internal/x",
      "@ayme-dev/vue/absent",
      "@ayme-dev/angular/package.json",
      "@ayme-dev/webmcp",
      "@ayme-dev/unplugin-ayme",
      "./ListPage",
    ])
      expect(absentEntryFor(untouched)).toBeUndefined();
  });
});
