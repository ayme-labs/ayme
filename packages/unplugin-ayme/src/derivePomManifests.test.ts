import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  derivePomManifestsFromProgram,
  type SkippedPomMethod,
} from "./derivePomManifests";
import { derivePomManifests } from "./index";
import { createPomProgram } from "./pomProgram";

function manifestFor(fixture: string) {
  return derivePomManifests(path.resolve(`src/fixtures/${fixture}.ts`))[0];
}

function manifestForClass(fixture: string, className: string) {
  return derivePomManifests(path.resolve(`src/fixtures/${fixture}.ts`)).find(
    (manifest) => manifest.className === className
  );
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
  });

  it.each(["privateRootPom", "protectedRootPom"])(
    "includes an inherited non-public root from %s without exposing other non-public members",
    (fixture) => {
      const manifest = manifestFor(fixture);

      expect(manifest?.members).toEqual([
        {
          memberName: "actionButton",
          kind: "locator",
          access: "field",
        },
        {
          memberName: "root",
          kind: "locator",
          access: "field",
        },
      ]);
    }
  );

  it("includes inherited public locator members", () => {
    const manifest = manifestFor("inheritedPom");

    expect(manifest?.members).toEqual([
      {
        memberName: "ownButton",
        kind: "locator",
        access: "field",
      },
      {
        memberName: "inheritedButton",
        kind: "locator",
        access: "field",
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
        },
        {
          memberName: "middleButton",
          kind: "locator",
          access: "field",
        },
        {
          memberName: "inheritedButton",
          kind: "locator",
          access: "field",
        },
        {
          memberName: "overriddenButton",
          kind: "locator",
          access: "field",
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
      },
      {
        memberName: "locatorGetter",
        kind: "locator",
        access: "getter",
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
        members: [
          { memberName: "root", kind: "locator", access: "field" },
          { memberName: "child", kind: "locator", access: "field" },
        ],
        tools: [],
      },
    ]);
  });

  it("rejects intersections containing multiple annotated components", () => {
    expect(() => manifestFor("ambiguousAnnotatedChildrenPom")).toThrow(
      'Page Object Child "ambiguousChild" is ambiguous: FirstComponent, SecondComponent.'
    );
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
      path.resolve("src/fixtures/twoPagesPom.ts")
    );
    const componentsOf = (className: string) =>
      manifests
        .find((manifest) => manifest.className === className)
        ?.components.map((component) => component.className);

    expect(componentsOf("SearchPage")).toEqual(["SearchBox", "ResultsPage"]);
    expect(componentsOf("SettingsPage")).toEqual([]);
  });

  it("lists Children of Children once, and reports their unmarked methods", () => {
    const fileName = path.resolve("src/fixtures/nestedChildren/shopPage.ts");
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
      return derivePomManifests(path.resolve(`src/fixtures/${fixture}.ts`));
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
        memberNames: ["signOutItem", "baseItem"],
      },
      {
        fixture: "barrelUserMenu",
        className: "BarrelUserMenu",
        memberNames: ["baseItem"],
      },
    ])(
      "recognises an undecorated subclass in $fixture.ts of a base decorated in another module",
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

    it("does not make a member typed as an undecorated class chain a Page Object Child", () => {
      expect(manifestsOf("undecoratedChildPom")).toEqual([
        {
          className: "PageX",
          members: [
            { memberName: "heading", kind: "locator", access: "field" },
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
      expect(parametersOf("recursive")?.[0]?.schema).toEqual({
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

    it.each([
      ["callablePom", "CallablePom.run(callback): () => void"],
      ["classInstancePom", "ClassInstancePom.schedule(at): Date"],
      ["openGenericPom", "OpenGenericPom.pick(value): T"],
    ])("still fails the build for %s", (fixture, parameter) => {
      expect(() =>
        derivePomManifests(
          path.resolve(`src/fixtures/unsupportedShapes/${fixture}.ts`)
        )
      ).toThrow(`Unsupported Page Object Tool input type for ${parameter}.`);
    });
  });
});
