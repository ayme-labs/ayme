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
});
