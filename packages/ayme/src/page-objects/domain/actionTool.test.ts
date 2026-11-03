import { describe, expect, it } from "vitest";

import {
  actionFacts,
  inputParameters,
  inputSchemaFor,
  methodArguments,
  requiredDescription,
} from "./actionTool";
import type { ToolManifest, ToolParameter } from "../../shared";

const refs: ToolParameter = {
  name: "refs",
  optional: false,
  schema: { type: "array", items: { type: "string" } },
  rest: true,
};

const query: ToolParameter = {
  name: "query",
  optional: false,
  schema: { type: "string" },
};

// `{ email, password }: { email: string; password: string }`
const credentials: ToolParameter = {
  destructured: "object",
  optional: false,
  fields: [
    { name: "email", optional: false, schema: { type: "string" } },
    { name: "password", optional: false, schema: { type: "string" } },
  ],
};

// `{ limit = 10 }: { limit?: number; order: "asc" | "desc" } = …`
const searchOptions: ToolParameter = {
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
};

// `[first, ...others]: [string, ...string[]]`
const path: ToolParameter = {
  destructured: "array",
  optional: false,
  fields: [
    { name: "first", optional: false, schema: { type: "string" } },
    {
      name: "others",
      optional: false,
      schema: { type: "array", items: { type: "string" } },
      rest: true,
    },
  ],
};

function tool(overrides: Partial<ToolManifest> = {}): ToolManifest {
  return {
    methodName: "open",
    toolName: "Page.open",
    parameters: [],
    ...overrides,
  };
}

describe("actionFacts", () => {
  it("keeps the author's description and the other Page Objects it returns", () => {
    expect(
      actionFacts(
        tool({
          description: "Open a related POM.",
          returnPoms: ["Page", "FirstReturnPom", "SecondReturnPom"],
        }),
        "Page"
      )
    ).toStrictEqual({
      authorDescription: "Open a related POM.",
      agentDescription:
        "Open a related POM. Then shows FirstReturnPom or SecondReturnPom.",
      returnPoms: ["FirstReturnPom", "SecondReturnPom"],
    });
  });

  it("says nothing for a bare action that returns nothing or itself", () => {
    expect(actionFacts(tool(), "Page")).toStrictEqual({});
    expect(actionFacts(tool({ description: " " }), "Page")).toStrictEqual({});
    expect(actionFacts(tool({ returnPoms: ["Page"] }), "Page")).toStrictEqual(
      {}
    );
  });

  it.each([
    [{ description: "Clear the done items." }, "Clear the done items."],
    [{ returnPoms: ["SettingsPage"] }, "Shows SettingsPage."],
    [
      { returnPoms: ["SettingsPage", "HelpPage"] },
      "Shows SettingsPage or HelpPage.",
    ],
    [
      { description: "Clear the done items.", returnPoms: ["SettingsPage"] },
      "Clear the done items. Then shows SettingsPage.",
    ],
  ] as const)(
    "gives an action with %j the Agent Description %j",
    (given, text) => {
      expect(
        actionFacts(tool(given as Partial<ToolManifest>), "Page")
          .agentDescription
      ).toBe(text);
    }
  );
});

describe("requiredDescription", () => {
  it("is the Agent Description when there is one", () => {
    expect(
      requiredDescription({
        name: "ListPage.clearDone",
        agentDescription: "Shows SettingsPage.",
      })
    ).toBe("Shows SettingsPage.");
  });

  it("runs a tool without one by its action's name", () => {
    expect(requiredDescription({ name: "ListPage.clearDone" })).toBe(
      "Run clearDone."
    );
    expect(requiredDescription({ name: "snapshot" })).toBe("Run snapshot.");
  });
});

describe("inputSchemaFor", () => {
  it("puts a literal default in the parameter's schema", () => {
    expect(
      inputSchemaFor([
        { name: "name", optional: false, schema: { type: "string" } },
        {
          name: "type",
          optional: true,
          schema: { type: "string", enum: ["personal", "account", "team"] },
          default: "personal",
        },
      ])
    ).toStrictEqual({
      type: "object",
      properties: {
        name: { type: "string" },
        type: {
          type: "string",
          enum: ["personal", "account", "team"],
          default: "personal",
        },
      },
      required: ["name"],
      additionalProperties: false,
    });
  });

  it("lets agents leave out a rest parameter with no minimum", () => {
    expect(inputSchemaFor([refs]).required).toEqual([]);
    expect(inputParameters([refs])[0]?.optional).toBe(true);
  });

  it("takes a destructured parameter's fields beside the other parameters", () => {
    expect(inputSchemaFor([query, credentials])).toStrictEqual({
      type: "object",
      properties: {
        query: { type: "string" },
        email: { type: "string" },
        password: { type: "string" },
      },
      required: ["query", "email", "password"],
      additionalProperties: false,
    });
  });

  it("lets agents leave out the fields of an optional pattern, and a rest element with no minimum", () => {
    expect(inputSchemaFor([searchOptions, path])).toStrictEqual({
      type: "object",
      properties: {
        limit: { type: "number", default: 10 },
        order: { type: "string", enum: ["asc", "desc"] },
        first: { type: "string" },
        others: { type: "array", items: { type: "string" } },
      },
      required: ["first"],
      additionalProperties: false,
    });
  });

  it("requires a rest parameter whose tuple has required elements", () => {
    expect(
      inputSchemaFor([
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
      ]).required
    ).toEqual(["args"]);
  });
});

describe("methodArguments", () => {
  it("spreads a rest parameter's list into the remaining arguments", () => {
    expect(
      methodArguments(
        [{ name: "group", optional: false, schema: { type: "number" } }, refs],
        { group: 1, refs: ["a", "b"] }
      )
    ).toEqual([1, "a", "b"]);
  });

  it("passes no arguments for a rest parameter left out", () => {
    expect(methodArguments([refs], {})).toEqual([]);
  });

  it("collects an object pattern's fields into one argument", () => {
    expect(
      methodArguments([query, credentials], {
        query: "milk",
        email: "a@b.c",
        password: "secret",
      })
    ).toEqual(["milk", { email: "a@b.c", password: "secret" }]);
  });

  it("passes an optional pattern none of whose fields are given as undefined, so its default applies", () => {
    expect(methodArguments([query, searchOptions], { query: "milk" })).toEqual([
      "milk",
      undefined,
    ]);
    expect(
      methodArguments([query, searchOptions], { query: "milk", limit: 5 })
    ).toEqual(["milk", { limit: 5 }]);
  });

  it("passes a required pattern none of whose fields are given as an empty object", () => {
    expect(
      methodArguments(
        [
          {
            destructured: "object",
            optional: false,
            fields: [
              { name: "limit", optional: true, schema: { type: "number" } },
            ],
          },
        ],
        {}
      )
    ).toEqual([{}]);
  });

  it("collects an array pattern's fields into one array, a rest element's list spread", () => {
    expect(methodArguments([path], { first: "a", others: ["b", "c"] })).toEqual(
      [["a", "b", "c"]]
    );
    expect(methodArguments([path], { first: "a" })).toEqual([["a"]]);
  });

  it("spreads a destructured rest parameter's array into the remaining arguments", () => {
    expect(
      methodArguments(
        [
          {
            destructured: "array",
            optional: false,
            rest: true,
            fields: [
              { name: "name", optional: false, schema: { type: "string" } },
              { name: "count", optional: false, schema: { type: "number" } },
            ],
          },
        ],
        { name: "a", count: 2 }
      )
    ).toEqual(["a", 2]);
  });

  it("reads only the input's own fields", () => {
    expect(
      methodArguments(
        [{ name: "constructor", optional: true, schema: { type: "string" } }],
        {}
      )
    ).toEqual([undefined]);
  });
});
