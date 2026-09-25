import path from "node:path";

import { describe, expect, it } from "vitest";

import { derivePomManifests } from "./index";

function manifestFor(fixture: string) {
  return derivePomManifests(path.resolve(`src/fixtures/${fixture}.ts`))[0];
}

function manifestForClass(fixture: string, className: string) {
  return derivePomManifests(path.resolve(`src/fixtures/${fixture}.ts`)).find(
    (manifest) => manifest.className === className
  );
}

describe("derivePomManifests", () => {
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

  it("includes inherited decorated tools", () => {
    const manifest = manifestFor("inheritedPom");

    expect(manifest?.tools).toEqual([
      {
        methodName: "inheritedTool",
        toolName: "InheritedPom.inheritedTool",
        description: "Use the inherited tool.",
        authoredDescription: "Use the inherited tool.",
        inputSchema: {
          type: "object",
          properties: {
            value: { type: "string" },
          },
          required: ["value"],
          additionalProperties: false,
        },
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
      'WebMCP component member "ambiguousChild" is ambiguous: FirstComponent, SecondComponent.'
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
          description:
            "Open a related POM. Potential return POMs: FirstReturnPom, SecondReturnPom.",
          authoredDescription: "Open a related POM.",
        },
        {
          methodName: "status",
          description: "Run status.",
        },
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
    expect(status).not.toHaveProperty("authoredDescription");
  });

  describe("inherited @WebMCP recognition", () => {
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
        'WebMCP component member "ambiguousMenu" is ambiguous: UserMenu, AdminMenu.'
      );
    });
  });
});
