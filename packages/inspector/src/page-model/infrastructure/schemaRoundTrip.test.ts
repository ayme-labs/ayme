// @vitest-environment node

import type { JsonValue } from "@ayme-dev/ayme";
import {
  inputSchemaFor,
  renderPomDefinitions,
  toolInputViolations,
  type ToolParameter,
} from "@ayme-dev/ayme/internal";
import { derivePomManifests } from "@ayme-dev/unplugin-ayme";
import { describe, expect, it } from "vitest";

import { actionSignature } from "./actionSignature";

// Contract: one schema, three readers. The build plugin compiles a Page
// Object's parameters, the runtime derives a schema and validates calls against it,
// and agents and the Inspector both render it. Each fixture action's schema
// must accept a matching call, and the Inspector must show the signature
// the definition text gives agents.

/** A fixture of the build plugin's compiler tests. */
function fixture(name: string) {
  return new URL(
    `../../../../unplugin-ayme/src/fixtures/${name}.ts`,
    import.meta.url
  ).pathname;
}

const tools = [
  "parameterShapesPom",
  "defaultedParametersPom",
  "destructuredParametersPom",
].flatMap((name) =>
  derivePomManifests(fixture(name)).flatMap((manifest) => manifest.tools)
);

/** A call each action's schema must accept, by tool name. */
const calls: Record<string, Record<string, JsonValue>> = {
  "ParameterShapesPom.array": { tags: ["a", "b"] },
  "ParameterShapesPom.readonlyArray": { sizes: [1, 2], labels: ["a"] },
  "ParameterShapesPom.tuple": {
    point: [1, "x"],
    range: [1],
    path: ["root", 1, 2],
  },
  "ParameterShapesPom.rest": { group: 1, refs: ["a", "b"] },
  "ParameterShapesPom.tupleEdges": { none: [], args: ["name", 2] },
  "ParameterShapesPom.record": { values: { a: "x", b: 1 } },
  "ParameterShapesPom.indexSignature": {
    flags: { on: true },
    labelled: { title: "Title", note: "x" },
  },
  "ParameterShapesPom.primitiveUnion": { value: "x", size: "auto" },
  "ParameterShapesPom.nullable": { note: null, count: null },
  "ParameterShapesPom.recursive": { value: { a: [1, "x", { b: 2 }] } },
  "DefaultedParametersPom.create": { name: "Board" },
  "DefaultedParametersPom.literals": {},
  "DefaultedParametersPom.computed": { count: 2 },
  "DefaultedParametersPom.optional": { note: "n" },
  "DefaultedParametersPom.both": { type: "team" },
  "DestructuredParametersPom.signIn": { email: "a@b.c", password: "secret" },
  "DestructuredParametersPom.signInAs": {
    email: "a@b.c",
    password: "secret",
    remember: true,
  },
  "DestructuredParametersPom.search": { query: "milk" },
  "DestructuredParametersPom.move": { x: 1, y: 2 },
  "DestructuredParametersPom.follow": { start: 1, others: ["b", "c"] },
  "DestructuredParametersPom.spread": { name: "a", count: 2 },
};

/** The action's line in the definition text agents read. */
function definitionLine(name: string, parameters: readonly ToolParameter[]) {
  return renderPomDefinitions([
    {
      name: "Pom",
      children: [],
      actions: [
        {
          name,
          inputSchema: inputSchemaFor(parameters),
          parameters,
          returnPoms: [],
        },
      ],
    },
  ]).split("\n")[1];
}

describe("an action's schema, compiled, validated and rendered", () => {
  it("has a matching call for every fixture action", () => {
    expect(tools.map((tool) => tool.toolName).sort()).toEqual(
      Object.keys(calls).sort()
    );
  });

  it.each(tools.map((tool) => [tool.toolName, tool] as const))(
    "%s accepts a matching call",
    (toolName, tool) => {
      expect(
        toolInputViolations(inputSchemaFor(tool.parameters), calls[toolName])
      ).toEqual([]);
    }
  );

  it.each(tools.map((tool) => [tool.toolName, tool] as const))(
    "%s shows agents' signature in the Inspector",
    (_, tool) => {
      expect(`  ${tool.methodName}${actionSignature(tool.parameters)}`).toBe(
        definitionLine(tool.methodName, tool.parameters)
      );
    }
  );

  it("renders unions, tuples, maps and rest parameters as TypeScript", () => {
    const signatureOf = (methodName: string) =>
      actionSignature(
        tools.find((tool) => tool.methodName === methodName)!.parameters
      );

    expect(signatureOf("primitiveUnion")).toBe(
      '(value: string | boolean, size?: number | "auto")'
    );
    expect(signatureOf("tuple")).toBe(
      "(point: [number, string], range: [number, number?], path: [string, ...number[]])"
    );
    expect(signatureOf("record")).toBe(
      "(values: { [key: string]: string | number })"
    );
    expect(signatureOf("rest")).toBe("(group: number, refs?: string[])");
  });

  it("renders a destructured parameter in the shape of its pattern", () => {
    const signatureOf = (methodName: string) =>
      actionSignature(
        tools.find((tool) => tool.methodName === methodName)!.parameters
      );

    expect(signatureOf("signIn")).toBe("({ email: string; password: string })");
    expect(signatureOf("signInAs")).toBe(
      "({ email: string; password: string; remember?: boolean })"
    );
    // A defaulted pattern's fields may each be left out.
    expect(signatureOf("search")).toBe(
      '(query: string, { limit?: number; order?: "asc" | "desc" })'
    );
    expect(signatureOf("move")).toBe("([x: number, y: number])");
    expect(signatureOf("follow")).toBe(
      "([start: number, end?: number], [first?: string, ...others: string[]])"
    );
    expect(signatureOf("spread")).toBe("(...[name: string, count: number])");
  });
});
