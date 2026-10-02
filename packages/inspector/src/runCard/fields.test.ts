import { describe, expect, it } from "vitest";

import {
  argumentsFromJson,
  argumentsToJson,
  fieldsOf,
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
    expect(fieldsOf(addItem)).toEqual([
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

  it("types a string by its format", () => {
    const [email, url, time] = fieldsOf({
      type: "object",
      properties: {
        email: { type: "string", format: "email" },
        url: { type: "string", format: "uri" },
        time: { type: "string", format: "time" },
      } as never,
    });

    expect(email).toMatchObject({ inputType: "email", typeLabel: "email" });
    expect(url).toMatchObject({ inputType: "url", typeLabel: "uri" });
    expect(time).toMatchObject({ inputType: "text", typeLabel: "time" });
  });

  it("starts a form from the first choice of a required choice", () => {
    expect(initialArguments(addItem)).toEqual({ priority: "low" });
  });

  it("names an action's signature, marking optional arguments", () => {
    expect(signatureOf(addItem)).toBe(
      "(text, copies, urgent?, priority, details?, ref?, extra?)"
    );
    expect(signatureOf({ type: "object" })).toBe("()");
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

  it("reports invalid JSON", () => {
    const parsed = argumentsFromJson('{ "text": ');

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
