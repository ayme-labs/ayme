import fs from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  derivePomManifests,
  derivePomManifestsFromProgram,
  type SkippedPomMethod,
} from "./derivePomManifests";
import { createPomProgram } from "./pomProgram";
import { version } from "../../package.json";

// Each test builds TypeScript Programs, which run several times slower on CI
// while the browser suites and the packed-consumer test run beside them.
vi.setConfig({ testTimeout: 15_000 });

/**
 * The line of a fixture that holds `text`, as the file stands: a header a
 * tool adds to it, such as Stryker's `// @ts-nocheck`, moves it too.
 */
function lineOf(fileName: string, text: string) {
  const lines = fs.readFileSync(fileName, "utf8").split("\n");
  return lines.findIndex((line) => line.includes(text)) + 1;
}

function manifestFor(fixture: string) {
  return derivePomManifests(
    path.resolve(`src/compiler/fixtures/${fixture}.ts`)
  )[0];
}

function manifestForClass(fixture: string, className: string) {
  return derivePomManifests(
    path.resolve(`src/compiler/fixtures/${fixture}.ts`)
  ).find((manifest) => manifest.className === className);
}

describe("derivePomManifests", () => {
  describe("the ayme markers", () => {
    it("derives a Page Object Model and its tools from the bare forms", () => {
      const manifest = manifestForClass("aymeFormsPom", "BarePom");

      expect(manifest).not.toHaveProperty("description");
      expect(manifest?.tools).toEqual([
        {
          methodName: "open",
          toolName: "BarePom.open",
          parameters: [],
        },
        {
          methodName: "close",
          toolName: "BarePom.close",
          parameters: [],
        },
      ]);
    });

    it("derives the descriptions of the options forms", () => {
      const manifest = manifestForClass("aymeFormsPom", "DescribedPom");

      expect(manifest).toMatchObject({
        description: "A page that saves a name.",
        tools: [
          {
            toolName: "DescribedPom.save",
            description: "Save the name.",
          },
        ],
      });
    });

    it("folds concatenated literals and templates without substitutions into the descriptions", () => {
      const manifest = manifestFor("constantDescriptionsPom");

      expect(manifest).toMatchObject({
        description: "A page that saves a name.",
        tools: [
          {
            toolName: "ConstantDescriptionsPom.save",
            description: "Save the name, then show it.",
          },
          {
            toolName: "ConstantDescriptionsPom.clear",
            description: "Clear the name.",
          },
          {
            toolName: "ConstantDescriptionsPom.undo",
            description: "Undo the last change.",
          },
          {
            toolName: "ConstantDescriptionsPom.redo",
            description: "Redo.",
          },
          {
            toolName: "ConstantDescriptionsPom.copy",
            description: "Copy the name.",
          },
          { toolName: "ConstantDescriptionsPom.paste" },
        ],
      });
      expect(manifest?.tools.at(-1)).not.toHaveProperty("description");
    });

    it.each([
      [
        "templateActionPom",
        "Page Object Action TemplateActionPom.show",
        "description: `Show",
      ],
      [
        "variableClassPom",
        "Page Object VariableClassPom",
        "@ayme({ description",
      ],
      [
        "quotedKeyPom",
        "Page Object Action QuotedKeyPom.save",
        '"description": DESCRIPTION',
      ],
    ])(
      "fails the build for the description of %s, which is not a constant string",
      (fixture, owner, description) => {
        const fileName = path.resolve(
          `src/compiler/fixtures/computedDescriptions/${fixture}.ts`
        );
        expect(() => derivePomManifests(fileName)).toThrow(
          `The description of ${owner} is not a constant string (${fileName}:${lineOf(fileName, description)}).`
        );
      }
    );
  });

  it.each([
    ["spreadActionPom", "SpreadActionPom.read", "...options,"],
    ["spreadOnlyActionPom", "SpreadOnlyActionPom.remove", "...options })"],
    ["computedKeyActionPom", "ComputedKeyActionPom.read", "[key]:"],
  ])(
    "fails the build for %s, whose description may come from a spread or a computed key",
    (fixture, action, description) => {
      const fileName = path.resolve(
        `src/compiler/fixtures/computedDescriptions/${fixture}.ts`
      );
      expect(() => derivePomManifests(fileName)).toThrow(
        `The description of Page Object Action ${action} may come from a spread or a computed key (${fileName}:${lineOf(fileName, description)}).`
      );
    }
  );

  it.each(["privateRootPom", "protectedRootPom"])(
    "leaves a non-public member named root out of %s like any other non-public member",
    (fixture) => {
      const manifest = manifestFor(fixture);

      expect(manifest?.members).toEqual([
        {
          memberName: "actionButton",
          kind: "locator",
          access: "field",
          collection: false,
        },
      ]);
    }
  );

  it("lists a public member named root as an ordinary locator member, in declaration order", () => {
    const manifest = manifestForClass(
      "annotatedChildrenPom",
      "AnnotatedChildrenPom"
    );

    expect(manifest?.components[0]?.members).toEqual([
      {
        memberName: "root",
        kind: "locator",
        access: "field",
        collection: false,
      },
      {
        memberName: "child",
        kind: "locator",
        access: "field",
        collection: false,
      },
    ]);
  });

  it("includes inherited public locator members", () => {
    const manifest = manifestFor("inheritedPom");

    expect(manifest?.members).toEqual([
      {
        memberName: "ownButton",
        kind: "locator",
        access: "field",
        collection: false,
      },
      {
        memberName: "inheritedButton",
        kind: "locator",
        access: "field",
        collection: false,
      },
    ]);
  });

  describe("parameters with a default value", () => {
    function toolFor(methodName: string) {
      return manifestFor("defaultedParametersPom")?.tools.find(
        (tool) => tool.methodName === methodName
      );
    }

    it("records a defaulted parameter as optional with its literal default", () => {
      expect(toolFor("create")?.parameters).toEqual([
        { name: "name", optional: false, schema: { type: "string" } },
        {
          name: "type",
          optional: true,
          schema: { type: "string", enum: ["personal", "account", "team"] },
          default: "personal",
        },
      ]);
    });

    it("records number, negative number, boolean and template literal defaults", () => {
      expect(toolFor("literals")?.parameters).toEqual([
        {
          name: "count",
          optional: true,
          schema: { type: "number" },
          default: 3,
        },
        {
          name: "offset",
          optional: true,
          schema: { type: "number" },
          default: -1,
        },
        {
          name: "archived",
          optional: true,
          schema: { type: "boolean" },
          default: false,
        },
        {
          name: "label",
          optional: true,
          schema: { type: "string" },
          default: "plain",
        },
      ]);
    });

    it("records a non-literal default as optional without a default", () => {
      expect(toolFor("computed")?.parameters).toEqual([
        { name: "name", optional: true, schema: { type: "string" } },
        { name: "count", optional: true, schema: { type: "number" } },
        { name: "size", optional: true, schema: { type: "number" } },
      ]);
    });

    it("keeps `?` and `| undefined` parameters optional without a default", () => {
      expect(toolFor("optional")?.parameters).toEqual([
        { name: "note", optional: true, schema: { type: "string" } },
        { name: "tag", optional: true, schema: { type: "string" } },
      ]);
    });

    it("keeps a defaulted `| undefined` parameter optional", () => {
      expect(toolFor("both")?.parameters).toEqual([
        {
          name: "type",
          optional: true,
          schema: { type: "string", enum: ["personal", "account", "team"] },
          default: "team",
        },
      ]);
    });
  });

  it("includes inherited decorated tools", () => {
    const manifest = manifestFor("inheritedPom");

    expect(manifest?.tools).toEqual([
      {
        methodName: "inheritedTool",
        toolName: "InheritedPom.inheritedTool",
        description: "Use the inherited tool.",
        parameters: [
          {
            name: "value",
            optional: false,
            schema: { type: "string" },
          },
        ],
      },
    ]);
  });

  it("collects public members and tools through multi-level inheritance", () => {
    const manifest = manifestFor("multiLevelInheritedPom");
    if (!manifest) throw new Error("The POM manifest was not derived.");

    expect(manifest.members).toEqual(
      expect.arrayContaining([
        {
          memberName: "ownButton",
          kind: "locator",
          access: "field",
          collection: false,
        },
        {
          memberName: "middleButton",
          kind: "locator",
          access: "field",
          collection: false,
        },
        {
          memberName: "inheritedButton",
          kind: "locator",
          access: "field",
          collection: false,
        },
        {
          memberName: "overriddenButton",
          kind: "locator",
          access: "field",
          collection: false,
        },
      ])
    );
    expect(manifest.members).toHaveLength(4);
    expect(
      new Set(manifest.members.map((member) => member.memberName)).size
    ).toBe(4);
    expect(manifest.members).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ memberName: "basePrivateButton" }),
        expect.objectContaining({ memberName: "baseProtectedButton" }),
        expect.objectContaining({ memberName: "middlePrivateButton" }),
        expect.objectContaining({ memberName: "middleProtectedButton" }),
        expect.objectContaining({ memberName: "finalPrivateButton" }),
        expect.objectContaining({ memberName: "finalProtectedButton" }),
      ])
    );

    expect(manifest.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          methodName: "inheritedTool",
          toolName: "MultiLevelInheritedPom.inheritedTool",
          description: "Use the inherited base tool.",
        }),
        expect.objectContaining({
          methodName: "middleTool",
          toolName: "MultiLevelInheritedPom.middleTool",
          description: "Use the inherited middle tool.",
        }),
        expect.objectContaining({
          methodName: "overriddenTool",
          toolName: "MultiLevelInheritedPom.overriddenTool",
          description: "Use the final override tool.",
        }),
      ])
    );
    expect(manifest.tools).toHaveLength(3);
    expect(new Set(manifest.tools.map((tool) => tool.methodName)).size).toBe(3);
    expect(manifest.tools).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ methodName: "basePrivateTool" }),
        expect.objectContaining({ methodName: "baseProtectedTool" }),
      ])
    );
  });

  it("names a class's file by its package, whatever directory the build runs from", () => {
    const fileName = path.resolve(
      "src/compiler/fixtures/undecoratedChildPom.ts"
    );
    const fromPackage = derivePomManifests(fileName)[0]?.file;
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(path.resolve("/"));
    try {
      expect(derivePomManifests(fileName)[0]?.file).toBe(fromPackage);
    } finally {
      cwd.mockRestore();
    }
    expect(fromPackage).toBe(
      `@ayme-dev/ayme@${version}/src/compiler/fixtures/undecoratedChildPom.ts`
    );
  });

  it("discovers directly annotated component values and explicit collections", () => {
    const manifest = manifestForClass(
      "annotatedChildrenPom",
      "AnnotatedChildrenPom"
    );
    if (!manifest) throw new Error("The POM manifest was not derived.");

    expect(manifest.members).toEqual([
      {
        memberName: "directField",
        kind: "component",
        access: "field",
        componentClassName: "AnnotatedComponent",
        collection: false,
      },
      {
        memberName: "directGetter",
        kind: "component",
        access: "getter",
        componentClassName: "AnnotatedComponent",
        collection: false,
      },
      {
        memberName: "directIntersection",
        kind: "component",
        access: "field",
        componentClassName: "AnnotatedComponent",
        collection: false,
      },
      {
        memberName: "fynkChild",
        kind: "component",
        access: "field",
        componentClassName: "AnnotatedComponent",
        collection: false,
      },
      {
        memberName: "browserLocator",
        kind: "locator",
        access: "field",
        collection: false,
      },
      {
        memberName: "locatorGetter",
        kind: "locator",
        access: "getter",
        collection: false,
      },
      {
        memberName: "componentCollection",
        kind: "component",
        access: "method",
        componentClassName: "AnnotatedComponent",
        collection: true,
      },
      {
        memberName: "readonlyComponentCollection",
        kind: "component",
        access: "method",
        componentClassName: "AnnotatedComponent",
        collection: true,
      },
      {
        memberName: "readonlyArrayComponentCollection",
        kind: "component",
        access: "method",
        componentClassName: "AnnotatedComponent",
        collection: true,
      },
      {
        memberName: "directAliasCollection",
        kind: "component",
        access: "method",
        componentClassName: "AnnotatedComponent",
        collection: true,
      },
      {
        memberName: "genericAliasCollection",
        kind: "component",
        access: "method",
        componentClassName: "AnnotatedComponent",
        collection: true,
      },
    ]);
    expect(manifest.components).toEqual([
      {
        className: "AnnotatedComponent",
        file: `@ayme-dev/ayme@${version}/src/compiler/fixtures/annotatedChildrenPom.ts`,
        members: [
          {
            memberName: "root",
            kind: "locator",
            access: "field",
            collection: false,
          },
          {
            memberName: "child",
            kind: "locator",
            access: "field",
            collection: false,
          },
        ],
        tools: [],
      },
    ]);
  });

  describe("declared Page Object Children", () => {
    it("reads each declared shape, its cardinality and its description", () => {
      const manifest = manifestForClass(
        "declaredChildrenPom",
        "DeclaredChildrenPom"
      );

      expect(manifest?.members).toEqual([
        {
          memberName: "heading",
          kind: "locator",
          access: "field",
          collection: false,
        },
        {
          memberName: "emptyMessage",
          kind: "locator",
          access: "getter",
          collection: false,
          description: "The message shown without runs.",
        },
        {
          memberName: "cells",
          kind: "locator",
          access: "field",
          collection: true,
          description: "One cell per column.",
        },
        {
          memberName: "links",
          kind: "locator",
          access: "getter",
          collection: true,
        },
        {
          memberName: "toolbar",
          kind: "component",
          access: "field",
          componentClassName: "Toolbar",
          collection: false,
          description: "Filters the runs.",
        },
        {
          memberName: "footer",
          kind: "component",
          access: "getter",
          componentClassName: "Toolbar",
          collection: false,
        },
        {
          memberName: "rows",
          kind: "component",
          access: "method",
          componentClassName: "Row",
          collection: true,
          description: "One row per run.",
        },
        {
          memberName: "readonlyRows",
          kind: "component",
          access: "method",
          componentClassName: "Row",
          collection: true,
        },
        {
          memberName: "aliasedRows",
          kind: "component",
          access: "method",
          componentClassName: "Row",
          collection: true,
        },
        {
          memberName: "visibleRows",
          kind: "component",
          access: "method",
          componentClassName: "Row",
          collection: true,
        },
      ]);
      expect(manifest?.components.map(({ className }) => className)).toEqual([
        "Toolbar",
        "Row",
      ]);
    });

    it.each([
      [
        "neitherPom",
        "Page Object Child NeitherPom.title holds neither a Locator nor a Page Object (string).",
      ],
      [
        "anyPom",
        "Page Object Child AnyPom.part has a type the build cannot resolve (any).",
      ],
      [
        "anyCollectionPom",
        "Page Object Child AnyCollectionPom.parts has a type the build cannot resolve (Promise<any[]>).",
      ],
      [
        "anyPromiseCollectionPom",
        "Page Object Child AnyPromiseCollectionPom.parts has a type the build cannot resolve (Promise<any>).",
      ],
      [
        "tupleChildPom",
        "Page Object Child TupleChildPom.pair holds neither a Locator nor a Page Object ([Row, Row]).",
      ],
      [
        "arrayFieldPom",
        "Page Object Child ArrayFieldPom.rows holds an array of Page Objects (Row[]); declare a method without parameters that returns them.",
      ],
      [
        "childArrayFieldPom",
        "Page Object Child ChildArrayFieldPom.rows is declared @ayme.child but holds many Page Objects (readonly Row[]).",
      ],
      [
        "childOnMethodPom",
        "Page Object Child ChildOnMethodPom.toolbar is a method; @ayme.child declares a field or getter.",
      ],
      [
        "childMethodPom",
        "Page Object Child ChildMethodPom.rows is declared @ayme.child but returns many Page Objects; declare it @ayme.collection.",
      ],
      [
        "collectionFieldPom",
        "Page Object Child CollectionFieldPom.toolbar is declared @ayme.collection but holds one Page Object (Toolbar); declare it @ayme.child.",
      ],
      [
        "parameterizedCollectionPom",
        "Page Object Child ParameterizedCollectionPom.rows takes parameters; @ayme.collection declares a method without parameters.",
      ],
      [
        "locatorMethodPom",
        "Page Object Child LocatorMethodPom.cells is a method returning a Locator; declare a Locator collection as a field or getter.",
      ],
      [
        "noPomCollectionPom",
        "Page Object Child NoPomCollectionPom.labels returns no Page Objects (Promise<string[]>).",
      ],
      [
        "singleMethodPom",
        "Page Object Child SingleMethodPom.toolbar returns one Page Object (Promise<Toolbar>); a Child Collection method returns an array of Page Objects.",
      ],
      [
        "bothMarkersPom",
        "Page Object Child BothMarkersPom.heading is declared more than once; mark it either @ayme.child or @ayme.collection.",
      ],
      [
        "actionChildPom",
        "Page Object Child ActionChildPom.rows is also marked @ayme.action; a member is either a Page Object Action or a Page Object Child.",
      ],
      [
        "mutableArrayMethodPom",
        "Page Object Child MutableArrayMethodPom.visibleRows returns a mutable array (Row[]); a Child Collection method returns Promise<Row[]> or readonly Row[].",
      ],
      [
        "privateChildPom",
        "Page Object Child PrivateChildPom.heading is private; only a public instance member can be a Page Object Child.",
      ],
      [
        "protectedChildPom",
        "Page Object Child ProtectedChildPom.rows is protected; only a public instance member can be a Page Object Child.",
      ],
      [
        "hashPrivateChildPom",
        "Page Object Child HashPrivateChildPom.#heading is private; only a public instance member can be a Page Object Child.",
      ],
      [
        "staticChildPom",
        "Page Object Child StaticChildPom.heading is static; only a public instance member can be a Page Object Child.",
      ],
      [
        "inheritedPrivateChildPom",
        "Page Object Child ListBase.rows is private; only a public instance member can be a Page Object Child.",
      ],
      [
        "stringNamedChildPom",
        'Page Object Child StringNamedChildPom."row" is not named by an identifier; only a member with an identifier name can be a Page Object Child.',
      ],
      [
        "computedNamedChildPom",
        'Page Object Child ComputedNamedChildPom.["row"] is not named by an identifier; only a member with an identifier name can be a Page Object Child.',
      ],
      [
        "setterChildPom",
        "Page Object Child SetterChildPom.part is a setter; only a field, getter or method can be a Page Object Child.",
      ],
      [
        "setterCollectionPom",
        "Page Object Child SetterCollectionPom.parts is a setter; only a field, getter or method can be a Page Object Child.",
      ],
    ])("fails the build for %s", (fixture, message) => {
      // An Error with this message: `toThrow(message)` also passes when
      // `undefined` is thrown.
      expect(() =>
        derivePomManifests(
          path.resolve(
            `src/compiler/fixtures/declaredChildErrors/${fixture}.ts`
          )
        )
      ).toThrow(new Error(message));
    });

    it("fails the build for a child description that is not a constant string", () => {
      const fileName = path.resolve(
        "src/compiler/fixtures/declaredChildErrors/descriptionPom.ts"
      );
      expect(() => derivePomManifests(fileName)).toThrow(
        new Error(
          `The description of Page Object Child DescriptionPom.heading is not a constant string (${fileName}:9).`
        )
      );
    });

    it("reads a Child Collection declared on an overloaded method's implementation", () => {
      const manifest = manifestForClass(
        "overloadedCollectionPom",
        "OverloadedCollectionPom"
      );

      expect(manifest?.members).toEqual([
        {
          memberName: "rows",
          kind: "component",
          access: "method",
          componentClassName: "Row",
          collection: true,
        },
      ]);
      expect(manifest?.components.map(({ className }) => className)).toEqual([
        "Row",
      ]);
    });

    it("reads a Child Collection from its implementation past every overload signature", () => {
      const manifest = manifestForClass(
        "multiOverloadedCollectionPom",
        "MultiOverloadedCollectionPom"
      );

      expect(manifest?.members).toEqual([
        {
          memberName: "rows",
          kind: "component",
          access: "method",
          componentClassName: "Row",
          collection: true,
        },
      ]);
    });

    it("reads a Child Collection by its overload without parameters, declared after one with parameters", () => {
      const manifest = manifestForClass(
        "reversedOverloadedCollectionPom",
        "ReversedOverloadedCollectionPom"
      );

      expect(manifest?.members).toEqual([
        {
          memberName: "rows",
          kind: "component",
          access: "method",
          componentClassName: "Row",
          collection: true,
        },
      ]);
    });

    it("inherits a declared child from an anonymous class, without a description it has none", () => {
      const manifest = manifestForClass(
        "anonymousBase/page",
        "AnonymousBasePom"
      );

      expect(manifest?.members).toEqual([
        {
          memberName: "heading",
          kind: "locator",
          access: "field",
          collection: false,
        },
      ]);
      expect(manifest?.members[0]).not.toHaveProperty("description");
    });

    it("inherits declared children through the class chain", () => {
      const manifest = manifestForClass(
        "inheritedDeclaredChildrenPom",
        "InheritedDeclaredChildrenPom"
      );

      expect(manifest?.members).toEqual([
        {
          memberName: "title",
          kind: "locator",
          access: "field",
          collection: false,
          description: "The list's title.",
        },
        {
          memberName: "rows",
          kind: "locator",
          access: "field",
          collection: true,
          description: "The list's rows.",
        },
        {
          memberName: "items",
          kind: "component",
          access: "method",
          componentClassName: "Item",
          collection: true,
        },
      ]);
    });
  });

  it("rejects intersections containing multiple annotated components", () => {
    expect(() => manifestFor("ambiguousAnnotatedChildrenPom")).toThrow(
      'Page Object Child "ambiguousChild" is ambiguous: FirstComponent, SecondComponent.'
    );
  });

  describe("two different classes with one name", () => {
    const fixture = (name: string) =>
      path.resolve(`src/compiler/fixtures/sameNamedChildren/${name}.ts`);
    const clash = (page: string, first: string, second: string) =>
      `Page Object "${page}" reaches two different classes named "Row", declared in ${fixture(
        first
      )} and ${fixture(second)}. Ayme tells the classes of a Page Object apart by name.`;

    it("rejects them as Children of one Page Object", () => {
      expect(() => derivePomManifests(fixture("page"))).toThrow(
        clash("ListsPage", "listA", "listB")
      );
    });

    it("rejects them as Children of Children", () => {
      expect(() => derivePomManifests(fixture("nestedPage"))).toThrow(
        clash("NestedListsPage", "listA", "listB")
      );
    });

    it("rejects them as a Child and an action's return POM", () => {
      expect(() => derivePomManifests(fixture("returnPage"))).toThrow(
        clash("ReturningListsPage", "listA", "listB")
      );
    });

    it("rejects a Child named like its Page Object", () => {
      expect(() => derivePomManifests(fixture("rowPage"))).toThrow(
        clash("Row", "rowPage", "listA")
      );
    });

    it("derives one component for one class behind several members", () => {
      const [manifest] = derivePomManifests(fixture("sameClassPage"));

      expect(
        manifest?.components.map((component) => component.className)
      ).toEqual(["Row"]);
      expect(manifest?.members).toMatchObject([
        { memberName: "first", componentClassName: "Row" },
        { memberName: "second", componentClassName: "Row" },
        { memberName: "rows", componentClassName: "Row", collection: true },
      ]);
    });
  });

  it("names the inheriting class where an inherited action returns its declaring class", () => {
    const manifest = manifestForClass("inheritedSelfReturnPom", "SettingsPage");

    expect(manifest?.tools).toMatchObject([
      { methodName: "save", returnPoms: ["SettingsPage"] },
      { methodName: "refresh", returnPoms: ["SettingsPage"] },
      { methodName: "openOther", returnPoms: ["OtherPage"] },
    ]);
  });

  it("captures class descriptions and Promise-union return POMs", () => {
    const manifest = manifestFor("returningPom");
    if (!manifest) throw new Error("The POM manifest was not derived.");

    expect(manifest).toMatchObject({
      className: "ReturningPom",
      description: "A page that opens related POMs.",
      tools: [
        {
          methodName: "open",
          returnPoms: ["FirstReturnPom", "SecondReturnPom"],
          description: "Open a related POM.",
        },
        { methodName: "status" },
      ],
      components: expect.arrayContaining([
        expect.objectContaining({
          className: "FirstReturnPom",
          description: "The first returned POM.",
        }),
        expect.objectContaining({ className: "SecondReturnPom" }),
      ]),
    });
    const status = manifest.tools.find((tool) => tool.methodName === "status");
    expect(status).not.toHaveProperty("description");
  });

  it("lists only the Children and return POMs of each Page Object in a file", () => {
    const manifests = derivePomManifests(
      path.resolve("src/compiler/fixtures/twoPagesPom.ts")
    );
    const componentsOf = (className: string) =>
      manifests
        .find((manifest) => manifest.className === className)
        ?.components.map((component) => component.className);

    expect(componentsOf("SearchPage")).toEqual(["SearchBox", "ResultsPage"]);
    expect(componentsOf("SettingsPage")).toEqual([]);
  });

  it("lists Children of Children once, and reports their unmarked methods", () => {
    const fileName = path.resolve(
      "src/compiler/fixtures/nestedChildren/shopPage.ts"
    );
    let skipped: SkippedPomMethod[] = [];
    const [manifest] = derivePomManifestsFromProgram(
      fileName,
      createPomProgram(fileName),
      (methods) => (skipped = methods)
    );

    // CartItem's action returns ShopPage, which closes the loop.
    expect(
      manifest?.components.map((component) => component.className)
    ).toEqual(["Cart", "CartItem", "ShopPage"]);
    expect(skipped).toEqual([{ name: "CartItem.quantity" }]);
  });

  describe("inherited @ayme recognition", () => {
    function manifestsOf(fixture: string) {
      return derivePomManifests(
        path.resolve(`src/compiler/fixtures/${fixture}.ts`)
      );
    }

    function expectNames(names: readonly string[], expected: string[]) {
      expect(new Set(names)).toEqual(new Set(expected));
      expect(names).toHaveLength(expected.length);
    }

    it("recognises an undecorated subclass of a decorated base and keeps the base", () => {
      const manifests = manifestsOf("decoratedBasePom");
      expectNames(
        manifests.map((manifest) => manifest.className),
        ["BaseMenu", "UserMenu"]
      );

      const userMenu = manifestForClass("decoratedBasePom", "UserMenu");
      if (!userMenu) throw new Error("UserMenu was not recognised.");
      expectNames(
        userMenu.members.map((member) => member.memberName),
        ["signOutItem", "baseItem"]
      );
      expectNames(
        userMenu.tools.map((tool) => tool.toolName),
        ["UserMenu.signOut", "UserMenu.open"]
      );
    });

    it.each([
      {
        fixture: "userMenu",
        className: "UserMenu",
        // Its own undeclared Locator is no Page Object Child.
        memberNames: ["baseItem"],
      },
      {
        fixture: "barrelUserMenu",
        className: "BarrelUserMenu",
        memberNames: ["baseItem"],
      },
    ])(
      "recognises an undecorated subclass in $fixture of a base decorated in another module, with only declared children",
      ({ fixture, className, memberNames }) => {
        const manifests = manifestsOf(`crossFile/${fixture}`);
        expectNames(
          manifests.map((manifest) => manifest.className),
          [className]
        );
        expectNames(
          manifests[0]?.members.map((member) => member.memberName) ?? [],
          memberNames
        );
        expectNames(manifests[0]?.tools.map((tool) => tool.toolName) ?? [], [
          `${className}.open`,
        ]);
      }
    );

    it("recognises every class below a decorator three levels up", () => {
      expectNames(
        manifestsOf("threeLevelDecoratedBasePom").map(
          (manifest) => manifest.className
        ),
        ["TopPom", "MiddlePom", "BottomPom"]
      );

      const bottom = manifestForClass(
        "threeLevelDecoratedBasePom",
        "BottomPom"
      );
      if (!bottom) throw new Error("BottomPom was not recognised.");
      expectNames(
        bottom.members.map((member) => member.memberName),
        ["bottomButton", "middleButton", "topButton"]
      );
      expectNames(
        bottom.tools.map((tool) => tool.toolName),
        ["BottomPom.bottomTool", "BottomPom.topTool"]
      );
    });

    it.each([
      ["ConfirmDialog", "A dialog that holds the page until it is closed."],
      ["PlainDialog", "A dialog that holds the page until it is closed."],
      ["DeleteDialog", "A dialog that holds the page until it is closed."],
      [
        "DeleteWorkspaceDialog",
        "Deleting the workspace removes it for every member.",
      ],
      [
        "DeleteWorkspaceForeverDialog",
        "Deleting the workspace removes it for every member.",
      ],
    ])(
      "gives %s the description of the nearest class that declares one",
      (className, description) => {
        expect(manifestForClass("describedBasePom", className)).toMatchObject({
          description,
        });
      }
    );

    it("gives no description through a base that only a merged interface adds", () => {
      expect(
        manifestForClass("describedBasePom", "PersonalPage")
      ).not.toHaveProperty("description");
    });

    it("does not make a member typed as an undecorated class chain a Page Object Child", () => {
      expect(manifestsOf("undecoratedChildPom")).toEqual([
        {
          className: "PageX",
          file: `@ayme-dev/ayme@${version}/src/compiler/fixtures/undecoratedChildPom.ts`,
          members: [
            {
              memberName: "heading",
              kind: "locator",
              access: "field",
              collection: false,
            },
          ],
          components: [],
          tools: [],
        },
      ]);
    });

    it("makes a member typed as an undecorated subclass of a decorated base a Page Object Child", () => {
      const page = manifestForClass("inheritedChildPom", "PageY");
      if (!page) throw new Error("PageY was not recognised.");

      expect(page.members).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            memberName: "userMenu",
            kind: "component",
            componentClassName: "UserMenu",
          }),
        ])
      );
      const userMenu = page.components.find(
        (component) => component.className === "UserMenu"
      );
      expectNames(userMenu?.members.map((member) => member.memberName) ?? [], [
        "signOutItem",
        "item",
      ]);
    });

    it("resolves an intersection of a subclass and its decorated ancestor to the subclass", () => {
      const page = manifestForClass("inheritedChildPom", "PageY");

      expect(page?.members).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            memberName: "narrowedMenu",
            kind: "component",
            componentClassName: "UserMenu",
          }),
        ])
      );
    });

    it("rejects an intersection of two unrelated recognised subclasses", () => {
      expect(() => manifestsOf("ambiguousInheritedChildrenPom")).toThrow(
        'Page Object Child "ambiguousMenu" is ambiguous: UserMenu, AdminMenu.'
      );
    });
  });

  it("builds a single root-less child and a rooted collection", () => {
    const manifest = manifestForClass(
      "rootlessChildrenPom",
      "RootlessChildrenPom"
    );

    expect(manifest?.members).toMatchObject([
      { memberName: "toolbar", componentClassName: "Toolbar" },
      { memberName: "rows", componentClassName: "Row", collection: true },
    ]);
    expect(
      manifest?.components.map((component) => component.className)
    ).toEqual(["Toolbar", "Row"]);
  });

  it("refuses a root-less class reached by two members of one Page Object", () => {
    expect(() => manifestFor("sharedRootlessPom")).toThrow(
      'The Page Object class "Toolbar" declares no root and is reached from more than one place: SharedRootlessPom.first, SharedRootlessPom.second.'
    );
  });

  it("counts paths through a shared rooted class separately", () => {
    expect(() => manifestFor("sharedNestedRootlessPom")).toThrow(
      'The Page Object class "Toolbar" declares no root and is reached from more than one place: SharedNestedRootlessPom.first.toolbar, SharedNestedRootlessPom.second.toolbar.'
    );
  });

  it("refuses a root-less child repeated by a recursive rooted parent", () => {
    expect(() => manifestFor("recursiveRootlessDescendantPom")).toThrow(
      'The Page Object class "Toolbar" declares no root and is reached from more than one place: RecursiveRootlessDescendantPom.toolbar, RecursiveRootlessDescendantPom.next.toolbar.'
    );
  });

  it("refuses a root-less child repeated by a recursive collection", () => {
    expect(() =>
      manifestFor("recursiveCollectionRootlessDescendantPom")
    ).toThrow(
      'The Page Object class "Toolbar" declares no root and is reached from more than one place: RecursiveCollectionRootlessDescendantPom.toolbar, RecursiveCollectionRootlessDescendantPom.children[].toolbar (below a collection).'
    );
  });

  it("refuses a root-less descendant of a rooted collection item", () => {
    expect(() => manifestFor("rootlessDescendantPom")).toThrow(
      'The Page Object class "Toolbar" declares no root and has many instances below a collection: RootlessDescendantPom.rows[].toolbar (below a collection).'
    );
  });

  it("does not count action return types as places reaching a root-less class", () => {
    const manifest = manifestForClass("rootlessReturnPom", "RootlessReturnPom");
    expect(manifest?.tools).toMatchObject([
      { methodName: "open", returnPoms: ["Toolbar"] },
      { methodName: "reopen", returnPoms: ["Toolbar"] },
    ]);
    expect(manifest?.members).toMatchObject([{ memberName: "toolbar" }]);
  });

  it("leaves undecidable roots to runtime and accepts roots inherited across modules", () => {
    const manifest = manifestForClass(
      "sharedRootOptionsPom",
      "SharedRootOptionsPom"
    );
    expect(
      manifest?.components.map((component) => component.className)
    ).toEqual(["Computed", "Spread", "Inherited"]);
  });

  describe("a collection item's root", () => {
    it("refuses a collection whose item class declares no root in its chain", () => {
      expect(() => manifestFor("rootlessCollectionPom")).toThrow(
        'The Page Object class "RootlessItem" declares no root and has many instances below a collection: RootlessCollectionPom.items[] (below a collection).'
      );
    });

    it("builds a collection whose item class inherits an inline root from a base", () => {
      expect(
        manifestForClass(
          "inheritedRootCollectionPom",
          "InheritedRootCollectionPom"
        )?.members
      ).toMatchObject([{ memberName: "items", collection: true }]);
    });

    it.each([
      ["factoryBaseCollectionPom", "FactoryBaseCollectionPom"],
      ["ambientBaseCollectionPom", "AmbientBaseCollectionPom"],
      [
        "namespaceAmbientBaseCollectionPom",
        "NamespaceAmbientBaseCollectionPom",
      ],
      ["constFactoryBaseCollectionPom", "ConstFactoryBaseCollectionPom"],
      ["stackedDecoratorsCollectionPom", "StackedDecoratorsCollectionPom"],
    ])(
      "leaves a base the build cannot read to the runtime: %s",
      (fixture, name) => {
        expect(manifestForClass(fixture, name)?.members).toMatchObject([
          { memberName: "items", collection: true },
        ]);
      }
    );

    it("leaves options held in a constant to the runtime", () => {
      expect(
        manifestForClass(
          "constOptionsCollectionPom",
          "ConstOptionsCollectionPom"
        )?.members
      ).toMatchObject([{ memberName: "items", collection: true }]);
    });
  });

  describe("parameter shapes", () => {
    function parametersOf(methodName: string) {
      return manifestFor("parameterShapesPom")?.tools.find(
        (tool) => tool.methodName === methodName
      )?.parameters;
    }

    it("schemas an array and a readonly array by their items", () => {
      expect(parametersOf("array")).toEqual([
        {
          name: "tags",
          optional: false,
          schema: { type: "array", items: { type: "string" } },
        },
      ]);
      expect(parametersOf("readonlyArray")).toEqual([
        {
          name: "sizes",
          optional: false,
          schema: { type: "array", items: { type: "number" } },
        },
        {
          name: "labels",
          optional: false,
          schema: {
            type: "array",
            items: { type: "string", enum: ["a", "b"] },
          },
        },
      ]);
    });

    it("schemas a tuple's elements with prefixItems, optional and rest elements included", () => {
      expect(parametersOf("tuple")).toEqual([
        {
          name: "point",
          optional: false,
          schema: {
            type: "array",
            prefixItems: [{ type: "number" }, { type: "string" }],
            minItems: 2,
            maxItems: 2,
          },
        },
        {
          name: "range",
          optional: false,
          schema: {
            type: "array",
            prefixItems: [{ type: "number" }, { type: "number" }],
            minItems: 1,
            maxItems: 2,
          },
        },
        {
          name: "path",
          optional: false,
          schema: {
            type: "array",
            prefixItems: [{ type: "string" }],
            minItems: 1,
            items: { type: "number" },
          },
        },
      ]);
    });

    it("records a rest parameter as a list", () => {
      const tool = manifestFor("parameterShapesPom")?.tools.find(
        ({ methodName }) => methodName === "rest"
      );

      expect(tool?.description).toBe("Take a rest parameter.");
      expect(tool?.parameters).toEqual([
        { name: "group", optional: false, schema: { type: "number" } },
        {
          name: "refs",
          optional: false,
          schema: { type: "array", items: { type: "string" } },
          rest: true,
        },
      ]);
    });

    it("leaves out an empty tuple's prefixItems", () => {
      expect(parametersOf("tupleEdges")).toEqual([
        {
          name: "none",
          optional: false,
          schema: { type: "array", maxItems: 0 },
        },
        {
          name: "args",
          optional: false,
          schema: {
            type: "array",
            prefixItems: [{ type: "string" }, { type: "number" }],
            minItems: 1,
            maxItems: 2,
          },
          rest: true,
        },
      ]);
    });

    it("schemas a Record by its value type", () => {
      expect(parametersOf("record")).toEqual([
        {
          name: "values",
          optional: false,
          schema: {
            type: "object",
            additionalProperties: {
              anyOf: [{ type: "string" }, { type: "number" }],
            },
          },
        },
      ]);
    });

    it("schemas an index signature, beside any declared properties", () => {
      expect(parametersOf("indexSignature")).toEqual([
        {
          name: "flags",
          optional: false,
          schema: {
            type: "object",
            additionalProperties: { type: "boolean" },
          },
        },
        {
          name: "labelled",
          optional: false,
          schema: {
            type: "object",
            properties: { title: { type: "string" } },
            required: ["title"],
            additionalProperties: { type: "string" },
          },
        },
      ]);
    });

    it("schemas a union of primitives as anyOf, literals merged into an enum", () => {
      expect(parametersOf("primitiveUnion")).toEqual([
        {
          name: "value",
          optional: false,
          schema: { anyOf: [{ type: "string" }, { type: "boolean" }] },
        },
        {
          name: "size",
          optional: true,
          schema: {
            anyOf: [{ type: "number" }, { type: "string", enum: ["auto"] }],
          },
        },
      ]);
    });

    it("schemas null in a union without making the parameter optional", () => {
      expect(parametersOf("nullable")).toEqual([
        {
          name: "note",
          optional: false,
          schema: { anyOf: [{ type: "null" }, { type: "string" }] },
        },
        {
          name: "count",
          optional: true,
          schema: { anyOf: [{ type: "null" }, { type: "number" }] },
        },
      ]);
    });

    it("schemas a recursive type down to its first repeat", () => {
      const repeat = {
        anyOf: [
          { type: "string" },
          { type: "number" },
          { type: "array" },
          { type: "object" },
        ],
      };
      expect(parametersOf("recursive")?.[0]).toHaveProperty("schema", {
        anyOf: [
          { type: "string" },
          { type: "number" },
          {
            type: "array",
            items: {
              anyOf: [
                { type: "string" },
                { type: "number" },
                { type: "array" },
                { type: "object", additionalProperties: repeat },
              ],
            },
          },
          {
            type: "object",
            additionalProperties: {
              anyOf: [
                { type: "string" },
                { type: "number" },
                { type: "array", items: repeat },
                { type: "object" },
              ],
            },
          },
        ],
      });
    });

    describe("a destructured parameter", () => {
      function destructuredParametersOf(methodName: string) {
        return manifestFor("destructuredParametersPom")?.tools.find(
          (tool) => tool.methodName === methodName
        )?.parameters;
      }

      it("takes an object pattern's fields from its type, keyed by property name", () => {
        expect(destructuredParametersOf("signIn")).toStrictEqual([
          {
            destructured: "object",
            optional: false,
            fields: [
              { name: "email", optional: false, schema: { type: "string" } },
              { name: "password", optional: false, schema: { type: "string" } },
            ],
          },
        ]);
        // Every property of the type, whatever the pattern binds or renames.
        expect(destructuredParametersOf("signInAs")).toStrictEqual([
          {
            destructured: "object",
            optional: false,
            fields: [
              { name: "email", optional: false, schema: { type: "string" } },
              { name: "password", optional: false, schema: { type: "string" } },
              { name: "remember", optional: true, schema: { type: "boolean" } },
            ],
          },
        ]);
      });

      it("records a defaulted object pattern beside a named parameter, with its bindings' literal defaults", () => {
        expect(destructuredParametersOf("search")).toStrictEqual([
          { name: "query", optional: false, schema: { type: "string" } },
          {
            destructured: "object",
            optional: true,
            fields: [
              {
                name: "limit",
                optional: true,
                schema: { type: "number" },
                default: 10,
              },
              {
                name: "order",
                optional: false,
                schema: { type: "string", enum: ["asc", "desc"] },
              },
            ],
          },
        ]);
      });

      it("keys an array pattern's fields by the names it binds", () => {
        expect(destructuredParametersOf("move")).toStrictEqual([
          {
            destructured: "array",
            optional: false,
            fields: [
              { name: "x", optional: false, schema: { type: "number" } },
              { name: "y", optional: false, schema: { type: "number" } },
            ],
          },
        ]);
      });

      it("takes an array pattern's optional elements, a plain array's elements and a rest element", () => {
        expect(destructuredParametersOf("follow")).toStrictEqual([
          {
            destructured: "array",
            optional: false,
            fields: [
              { name: "start", optional: false, schema: { type: "number" } },
              {
                name: "end",
                optional: true,
                schema: { type: "number" },
                default: 9,
              },
            ],
          },
          {
            destructured: "array",
            optional: false,
            fields: [
              { name: "first", optional: true, schema: { type: "string" } },
              {
                name: "others",
                optional: false,
                schema: { type: "array", items: { type: "string" } },
                rest: true,
              },
            ],
          },
        ]);
      });

      it.each([
        [
          "holePom",
          "Page Object Action HolePom.move needs a name for every element of [, y]: [number, number]: element 0 is a hole.",
        ],
        [
          "nestedElementPom",
          "Page Object Action NestedElementPom.pick needs a name for every element of [{ a }, b]: [{ a: string }, number]: element 0 is a nested pattern.",
        ],
        [
          "unboundElementPom",
          "Page Object Action UnboundElementPom.move needs a name for every element of [x]: [number, number]: element 1 is not bound.",
        ],
        [
          "untypedBindingPom",
          "Page Object Action UntypedBindingPom.login: email, password and remember in { email, password, remember } have no type. Annotate the parameter.",
        ],
        [
          "misspelledBindingPom",
          "Page Object Action MisspelledBindingPom.signIn: emial in { emial, password: secret }: Credentials has no type.",
        ],
        [
          "arrayDuplicatePom",
          "Page Object Action ArrayDuplicatePom.move takes two input fields named x: property x of { y }: { x: number; y: number }, and binding x of [x]: [number].",
        ],
        [
          "indexSignaturePatternPom",
          `Unsupported Page Object Tool input type for IndexSignaturePatternPom.pick({ a }): Record<string, string>. Compiled with ${path.resolve("src/compiler/fixtures/tsconfig.json")}.`,
        ],
        [
          "stringPatternPom",
          `Unsupported Page Object Tool input type for StringPatternPom.initial([first]): string. Compiled with ${path.resolve("src/compiler/fixtures/tsconfig.json")}.`,
        ],
        [
          "tupleUnionPom",
          `Unsupported Page Object Tool input type for TupleUnionPom.move([x]): [number, number] | [number, number, number]. Compiled with ${path.resolve("src/compiler/fixtures/tsconfig.json")}.`,
        ],
        [
          "correlatedTuplePom",
          `Unsupported Page Object Tool input type for CorrelatedTuplePom.pair([x, y]): [string, number] | [number, string]. Compiled with ${path.resolve("src/compiler/fixtures/tsconfig.json")}.`,
        ],
        [
          "renamedDuplicatePom",
          "Page Object Action RenamedDuplicatePom.search takes two input fields named query: parameter query, and property query of { query: q }: { query: string }.",
        ],
        [
          "typeDuplicatePom",
          "Page Object Action TypeDuplicatePom.search takes two input fields named limit: parameter limit, and property limit of { order }: Options.",
        ],
        [
          "sharedPropertyPom",
          "Page Object Action SharedPropertyPom.copy takes two input fields named id: property id of { id }: { id: string }, and property id of { id: other }: { id: string }.",
        ],
      ])("fails the build for %s", (fixture, message) => {
        let thrown: unknown;
        try {
          derivePomManifests(
            path.resolve(
              `src/compiler/fixtures/unsupportedPatterns/${fixture}.ts`
            )
          );
        } catch (error) {
          thrown = error;
        }
        const positions: Record<string, number> = {
          indexSignaturePatternPom: 8,
          stringPatternPom: 11,
          tupleUnionPom: 8,
          correlatedTuplePom: 8,
        };
        const column = positions[fixture];
        expect((thrown as Error | undefined)?.message).toBe(
          column
            ? `${path.resolve(`src/compiler/fixtures/unsupportedPatterns/${fixture}.ts`)}:6:${column}: ${message}`
            : message
        );
      });

      it("takes an object pattern's quoted keys with their defaults, and its computed ones from the type", () => {
        expect(destructuredParametersOf("name")).toStrictEqual([
          {
            destructured: "object",
            optional: false,
            fields: [
              {
                name: "first-name",
                optional: false,
                schema: { type: "string" },
                default: "Ann",
              },
              { name: "last", optional: false, schema: { type: "string" } },
            ],
          },
        ]);
      });

      it("takes the properties an object pattern's rest binding gathers", () => {
        expect(destructuredParametersOf("remember")).toStrictEqual([
          {
            destructured: "object",
            optional: false,
            fields: [
              { name: "email", optional: false, schema: { type: "string" } },
              { name: "remember", optional: true, schema: { type: "boolean" } },
            ],
          },
        ]);
      });

      it("binds a tuple's remaining fixed elements, or leaves its variadic ones, to a rest element", () => {
        expect(destructuredParametersOf("tail")).toStrictEqual([
          {
            destructured: "array",
            optional: false,
            fields: [
              { name: "head", optional: false, schema: { type: "string" } },
              {
                name: "rest",
                optional: false,
                schema: {
                  type: "array",
                  prefixItems: [{ type: "number" }, { type: "number" }],
                  minItems: 2,
                  maxItems: 2,
                },
                rest: true,
              },
            ],
          },
        ]);
        expect(destructuredParametersOf("first")).toStrictEqual([
          {
            destructured: "array",
            optional: false,
            fields: [
              { name: "x", optional: false, schema: { type: "number" } },
            ],
          },
        ]);
      });

      it("records a destructured rest parameter as a rest array pattern", () => {
        expect(destructuredParametersOf("spread")).toStrictEqual([
          {
            destructured: "array",
            optional: false,
            rest: true,
            fields: [
              { name: "name", optional: false, schema: { type: "string" } },
              { name: "count", optional: false, schema: { type: "number" } },
            ],
          },
        ]);
      });
    });

    it.each([
      ["callablePom", "CallablePom.run(callback): () => void"],
      ["classInstancePom", "ClassInstancePom.schedule(at): Date"],
      ["openGenericPom", "OpenGenericPom.pick(value): T"],
    ])("still fails the build for %s", (fixture, parameter) => {
      expect(() =>
        derivePomManifests(
          path.resolve(`src/compiler/fixtures/unsupportedShapes/${fixture}.ts`)
        )
      ).toThrow(`Unsupported Page Object Tool input type for ${parameter}.`);
    });
  });
});
