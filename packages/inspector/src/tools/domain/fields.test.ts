import { describe, expect, it } from "vitest";
import type { JsonSchema } from "@ayme-dev/ayme";

import {
  argumentsFromJson,
  argumentsToJson,
  fieldsOf,
  groupFields,
  initialArguments,
  signatureOf,
  withArgument,
} from "./fields";

// Unit tests: the typed form's model, built from a tool's JSON Schema. The
// schema is a hand-written example of each kind the form supports.

const addItem = {
  type: "object",
  properties: {
    text: { type: "string" },
    copies: { type: "integer" },
    urgent: { type: "boolean" },
    priority: { type: "string", enum: ["low", "normal", "high"] },
    details: {
      type: "object",
      properties: {
        due: { type: "string", format: "date" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["tags"],
    },
    ref: { type: "string" },
    extra: { type: "object" },
  },
  required: ["text", "copies", "priority"],
} as const;

describe("schema to fields", () => {
  it("gives each property a typed field, in schema order", () => {
    expect(fieldsOf(addItem, { ref: "ref" })).toEqual([
      {
        name: "text",
        optional: false,
        kind: "text",
        inputType: "text",
        typeLabel: "string",
      },
      {
        name: "copies",
        optional: false,
        kind: "number",
        integer: true,
        typeLabel: "integer",
      },
      { name: "urgent", optional: true, kind: "boolean", typeLabel: "boolean" },
      {
        name: "priority",
        optional: false,
        kind: "choice",
        options: ["low", "normal", "high"],
        typeLabel: "low | normal | high",
      },
      {
        name: "details",
        optional: true,
        kind: "object",
        typeLabel: "object",
        fields: [
          {
            name: "due",
            optional: true,
            kind: "text",
            inputType: "date",
            typeLabel: "date",
          },
          {
            name: "tags",
            optional: false,
            kind: "list",
            typeLabel: "string[]",
            item: {
              name: "tags item",
              optional: false,
              kind: "text",
              inputType: "text",
              typeLabel: "string",
            },
          },
        ],
      },
      { name: "ref", optional: true, kind: "ref", typeLabel: "ref" },
      { name: "extra", optional: true, kind: "json", typeLabel: "object" },
    ]);
  });

  it("edits a tuple as JSON, since its fixed elements have their own types", () => {
    const path = {
      type: "object" as const,
      properties: {
        path: {
          type: "array" as const,
          prefixItems: [{ type: "string" as const }],
          items: { type: "number" as const },
        },
      },
    };

    expect(fieldsOf(path)[0]).toMatchObject({ name: "path", kind: "json" });
  });

  it("picks a ref only for the argument named as the tool's ref field", () => {
    const rename = {
      type: "object" as const,
      properties: { target: { type: "string" as const } },
    };

    expect(fieldsOf(rename)[0]).toMatchObject({ name: "target", kind: "text" });
    expect(fieldsOf(rename, { ref: "target" })[0]).toMatchObject({
      name: "target",
      kind: "ref",
    });
  });

  it("picks a key control only for the argument named as the tool's key field", () => {
    const pressKey = {
      type: "object" as const,
      properties: { key: { type: "string" as const } },
    };

    expect(fieldsOf(pressKey)[0]).toMatchObject({ name: "key", kind: "text" });
    expect(fieldsOf(pressKey, { key: "key" })[0]).toMatchObject({
      name: "key",
      kind: "key",
      typeLabel: "key",
    });
  });

  it("types a string by its format", () => {
    const [email, url, link, time] = fieldsOf({
      type: "object",
      properties: {
        email: { type: "string", format: "email" },
        url: { type: "string", format: "uri" },
        link: { type: "string", format: "url" },
        time: { type: "string", format: "time" },
      } as never,
    });

    expect(email).toMatchObject({ inputType: "email", typeLabel: "email" });
    expect(url).toMatchObject({ inputType: "url", typeLabel: "uri" });
    expect(link).toMatchObject({ inputType: "url", typeLabel: "url" });
    expect(time).toMatchObject({ inputType: "text", typeLabel: "time" });
  });

  it("edits a map of strings or numbers under any label as rows", () => {
    const values = {
      type: "object",
      description: "Passed to the Goal Loop with the goal.",
      additionalProperties: {
        anyOf: [{ type: "string" }, { type: "number" }],
      },
      maxProperties: 254,
    } as const;
    const tags = {
      type: "object",
      additionalProperties: { type: "string" },
    } as const;
    const nested = {
      type: "object",
      additionalProperties: { type: "object" },
    } as const;

    expect(
      fieldsOf({ type: "object", properties: { values, tags, nested } })
    ).toEqual([
      {
        name: "values",
        optional: true,
        kind: "map",
        valueTypes: ["string", "number"],
        maxEntries: 254,
        description: "Passed to the Goal Loop with the goal.",
        typeLabel: "",
      },
      {
        name: "tags",
        optional: true,
        kind: "map",
        valueTypes: ["string"],
        typeLabel: "",
      },
      // Values of any other type stay JSON.
      { name: "nested", optional: true, kind: "json", typeLabel: "object" },
    ]);
  });

  it("starts a form from the first choice of a required choice", () => {
    expect(initialArguments(addItem)).toEqual({ priority: "low" });
  });

  it("writes the signature it is given, and none without arguments", () => {
    const signature = () => "(text: string)";
    expect(signatureOf(addItem, signature)).toBe("(text: string)");
    expect(signatureOf({ type: "object" }, signature)).toBeUndefined();
  });

  it("labels a field edited as JSON with the type it is given, nested ones too", () => {
    const typeOf = (schema: JsonSchema) => `<${schema.type ?? "any"}>`;
    const schema: JsonSchema = {
      type: "object",
      properties: {
        value: { anyOf: [{ type: "string" }, { type: "number" }] },
        point: { type: "array", prefixItems: [{ type: "number" }] },
        details: { type: "object", properties: { extra: { type: "object" } } },
        text: { type: "string" },
      },
    };

    const [value, point, details, text] = fieldsOf(schema, { typeOf });

    expect(value).toMatchObject({ kind: "json", typeLabel: "<any>" });
    expect(point).toMatchObject({ kind: "json", typeLabel: "<array>" });
    expect(details).toMatchObject({
      kind: "object",
      fields: [{ kind: "json", typeLabel: "<object>" }],
    });
    expect(text).toMatchObject({ kind: "text", typeLabel: "string" });
  });
});

describe("a destructured parameter", () => {
  const search = {
    type: "object",
    properties: {
      query: { type: "string" },
      limit: { type: "number" },
      x: { type: "number" },
    },
    required: ["query", "x"],
  } satisfies JsonSchema;

  it("groups its fields, beside the other parameters' fields", () => {
    expect(
      groupFields(fieldsOf(search), [
        { name: "query", optional: false, schema: { type: "string" } },
        {
          destructured: "object",
          optional: false,
          fields: [
            { name: "limit", optional: true, schema: { type: "number" } },
          ],
        },
        {
          destructured: "array",
          optional: false,
          fields: [{ name: "x", optional: false, schema: { type: "number" } }],
        },
      ])
    ).toEqual([
      {
        name: "query",
        optional: false,
        kind: "text",
        inputType: "text",
        typeLabel: "string",
      },
      {
        kind: "group",
        fields: [
          {
            name: "limit",
            optional: true,
            kind: "number",
            integer: false,
            typeLabel: "number",
          },
        ],
      },
      {
        kind: "group",
        fields: [
          {
            name: "x",
            optional: false,
            kind: "number",
            integer: false,
            typeLabel: "number",
          },
        ],
      },
    ]);
  });

  it("marks a defaulted pattern's group optional, its fields as its type has them", () => {
    expect(
      groupFields(fieldsOf(search), [
        {
          destructured: "object",
          optional: true,
          fields: [
            { name: "query", optional: false, schema: { type: "string" } },
            { name: "limit", optional: true, schema: { type: "number" } },
          ],
        },
      ])
    ).toEqual([
      {
        kind: "group",
        optional: true,
        fields: [
          {
            name: "query",
            optional: false,
            kind: "text",
            inputType: "text",
            typeLabel: "string",
          },
          {
            name: "limit",
            optional: true,
            kind: "number",
            integer: false,
            typeLabel: "number",
          },
        ],
      },
    ]);
  });

  it("leaves a defaulted array pattern's rest element optional unless its type needs items", () => {
    const point = {
      type: "object",
      properties: {
        x: { type: "number" },
        others: { type: "array", items: { type: "number" } },
        first: { type: "number" },
        more: { type: "array", items: { type: "number" }, minItems: 1 },
      },
    } satisfies JsonSchema;
    // `[x, ...others]: [number, ...number[]] = [0]` and
    // `[first, ...more]: [number, number, ...number[]] = [0, 0]`
    const groups = groupFields(fieldsOf(point), [
      {
        destructured: "array",
        optional: true,
        fields: [
          { name: "x", optional: false, schema: { type: "number" } },
          {
            name: "others",
            optional: false,
            schema: { type: "array", items: { type: "number" } },
            rest: true,
          },
        ],
      },
      {
        destructured: "array",
        optional: true,
        fields: [
          { name: "first", optional: false, schema: { type: "number" } },
          {
            name: "more",
            optional: false,
            schema: {
              type: "array",
              items: { type: "number" },
              minItems: 1,
            },
            rest: true,
          },
        ],
      },
    ]);

    expect(
      groups.map((group) =>
        group.kind === "group"
          ? group.fields.map(({ name, optional }) => [name, optional])
          : []
      )
    ).toEqual([
      [
        ["x", false],
        ["others", true],
      ],
      [
        ["first", false],
        ["more", false],
      ],
    ]);
  });

  it("leaves out a destructured field the schema has no field for", () => {
    expect(
      groupFields(fieldsOf(search), [
        {
          destructured: "object",
          optional: false,
          fields: [
            { name: "limit", optional: true, schema: { type: "number" } },
            { name: "sort", optional: true, schema: { type: "string" } },
          ],
        },
      ])
    ).toEqual([
      {
        kind: "group",
        fields: [
          {
            name: "limit",
            optional: true,
            kind: "number",
            integer: false,
            typeLabel: "number",
          },
        ],
      },
    ]);
  });

  it("leaves the fields as they are without a destructured parameter", () => {
    const fields = fieldsOf(search);

    expect(groupFields(fields)).toEqual(fields);
    expect(
      groupFields(fields, [
        { name: "query", optional: false, schema: { type: "string" } },
      ])
    ).toEqual(fields);
  });
});

describe("editing the arguments", () => {
  it("sets a nested value and leaves the rest", () => {
    expect(
      withArgument({ text: "Milk" }, ["details", "due"], "2026-10-02")
    ).toEqual({ text: "Milk", details: { due: "2026-10-02" } });
  });

  it("removes a value set to undefined", () => {
    expect(
      withArgument(
        { text: "Milk", details: { due: "x" } },
        ["details"],
        undefined
      )
    ).toEqual({ text: "Milk" });
  });
});

describe("Form and JSON", () => {
  it("shows the form's arguments as JSON and reads them back", () => {
    const args = { text: "Milk", details: { tags: ["home"] } };

    const text = argumentsToJson(args);

    expect(JSON.parse(text)).toEqual(args);
    expect(argumentsFromJson(text)).toEqual({ ok: true, arguments: args });
  });

  it("reports where invalid JSON goes wrong", () => {
    expect(argumentsFromJson('{\n  "text": "Milk"\n  "count": 2\n}')).toEqual({
      ok: false,
      error:
        "Invalid JSON at line 3, column 3: expected ',' or '}', found '\"'.",
      position: { line: 3, column: 3 },
    });
    expect(argumentsFromJson('{ "text": ')).toEqual({
      ok: false,
      error:
        "Invalid JSON at line 1, column 11: expected a value, found the end of the text.",
      position: { line: 1, column: 11 },
    });
  });

  it("reports JSON nested too deep to place the error", () => {
    const parsed = argumentsFromJson("[".repeat(200_000));

    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.error).toMatch(/^Invalid JSON: /);
  });

  it("reports JSON that isn't an object", () => {
    expect(argumentsFromJson('["Milk"]')).toEqual({
      ok: false,
      error: "Arguments must be a JSON object.",
    });
    expect(argumentsFromJson("null")).toEqual({
      ok: false,
      error: "Arguments must be a JSON object.",
    });
  });
});
