import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Page } from "@playwright/test";
import type { PomManifest, ToolManifest } from "./contracts";

class FakeMutationObserver {
  observe() {}
  disconnect() {}
}

const action = (
  methodName: string,
  description = `Run ${methodName}.`,
  returnPoms: readonly string[] = []
): ToolManifest => ({
  methodName,
  toolName: methodName,
  description,
  authoredDescription: description,
  inputSchema: {
    type: "object",
    properties: { value: { type: "string" } },
    required: ["value"],
    additionalProperties: false,
  },
  parameters: [{ name: "value", optional: false, schema: { type: "string" } }],
  returnPoms,
});

function manifest(
  className: string,
  overrides: Partial<PomManifest> = {}
): PomManifest {
  return {
    className,
    members: [],
    components: [],
    tools: [],
    ...overrides,
  };
}

async function setup() {
  vi.resetModules();
  const registry = await import("./registry");
  const definitions = await import("./pomDefinitions");
  registry.configureAymeRuntime({} as Page);
  return { registry, definitions };
}

describe("POM definition catalog", () => {
  beforeEach(() => {
    vi.stubGlobal("document", { documentElement: {} });
    vi.stubGlobal("MutationObserver", FakeMutationObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("discovers child and return POMs that are not mounted, then drops them on disposal", async () => {
    const { definitions, registry } = await setup();
    class StartPage {}
    registry.registerCompiledPom(
      StartPage,
      manifest("StartPage", {
        description: "Start here.",
        members: [
          {
            memberName: "sidebar",
            kind: "component",
            access: "field",
            componentClassName: "Sidebar",
            collection: false,
          },
        ],
        tools: [action("open", "Open a dialog.", ["HiddenDialog"])],
        components: [
          {
            className: "Sidebar",
            description: "A visible child.",
            members: [],
            tools: [],
          },
          {
            className: "HiddenDialog",
            members: [],
            tools: [action("details", "Open details.", ["DetailsPom"])],
          },
          { className: "DetailsPom", members: [], tools: [] },
          { className: "UnusedPom", members: [], tools: [] },
        ],
      })
    );
    const registration = registry.createPageRegistration(StartPage);

    expect(definitions.getPomDefinitions()).toEqual({
      definitions: [
        {
          name: "StartPage",
          description: "Start here.",
          children: [
            {
              memberName: "sidebar",
              kind: "component",
              access: "field",
              componentClassName: "Sidebar",
              collection: false,
            },
          ],
          actions: [
            {
              name: "open",
              description: "Open a dialog.",
              inputSchema: {
                type: "object",
                properties: { value: { type: "string" } },
                required: ["value"],
                additionalProperties: false,
              },
              returnPoms: ["HiddenDialog"],
            },
          ],
        },
        {
          name: "Sidebar",
          description: "A visible child.",
          children: [],
          actions: [],
        },
        {
          name: "HiddenDialog",
          children: [],
          actions: [
            expect.objectContaining({
              name: "details",
              returnPoms: ["DetailsPom"],
            }),
          ],
        },
        { name: "DetailsPom", children: [], actions: [] },
      ],
    });

    registration.dispose();
    expect(definitions.getPomDefinitions()).toEqual({ definitions: [] });
  });

  it("uses one result shape for all, named, unknown, and duplicate definitions", async () => {
    const { definitions, registry } = await setup();
    class FirstPage {}
    class SecondPage {}
    class ConflictingPage {}
    class OtherConflictingPage {}
    const shared = manifest("SharedPage", { description: "Shared." });
    registry.registerCompiledPom(FirstPage, shared);
    registry.registerCompiledPom(SecondPage, shared);
    const registrations = [
      registry.createPageRegistration(FirstPage),
      registry.createPageRegistration(SecondPage),
    ];

    expect(definitions.getPomDefinitions()).toEqual({
      definitions: [
        {
          name: "SharedPage",
          description: "Shared.",
          children: [],
          actions: [],
        },
      ],
    });
    expect(definitions.getPomDefinitions("SharedPage")).toEqual({
      definitions: [
        {
          name: "SharedPage",
          description: "Shared.",
          children: [],
          actions: [],
        },
      ],
    });
    expect(definitions.getPomDefinitions("MissingPom")).toEqual({
      definitions: [],
    });

    expect(definitions.getPomDefinitions("SharedPage", "MissingPom")).toEqual({
      definitions: [
        {
          name: "SharedPage",
          description: "Shared.",
          children: [],
          actions: [],
        },
      ],
    });

    registry.registerCompiledPom(
      ConflictingPage,
      manifest("ConflictingPage", { description: "First definition." })
    );
    registry.registerCompiledPom(
      OtherConflictingPage,
      manifest("ConflictingPage", { description: "Second definition." })
    );
    registrations.push(
      registry.createPageRegistration(ConflictingPage),
      registry.createPageRegistration(OtherConflictingPage)
    );

    expect(() => definitions.getPomDefinitions("ConflictingPage")).toThrow(
      'POM definition "ConflictingPage" is ambiguous.'
    );
    expect(() => definitions.getPomDefinitions()).toThrow(
      'POM definition "ConflictingPage" is ambiguous.'
    );
    expect(() => definitions.getPomDefinitions()).toThrow(
      expect.objectContaining({
        name: "RefResolutionError",
        kind: "resolution",
      })
    );

    registrations.forEach((registration) => registration.dispose());
  });

  it("rejects runtime-invalid POM definition names", async () => {
    const { definitions } = await setup();

    expect(() => definitions.getPomDefinitions(42 as never)).toThrow(
      "POM definition names must be strings."
    );
    expect(() => definitions.getPomDefinitions(null as never)).toThrow(
      "POM definition names must be strings."
    );
    expect(() => definitions.getPomDefinitions({} as never)).toThrow(
      "POM definition names must be strings."
    );
    expect(() => definitions.getPomDefinitions(true as never)).toThrow(
      "POM definition names must be strings."
    );
    expect(() => definitions.getPomDefinitions(42 as never)).toThrow(
      expect.objectContaining({ name: "ToolInputError", kind: "input" })
    );
  });

  it("keeps definition action descriptions and schemas equal to callable tools", async () => {
    const { definitions, registry } = await setup();
    class ToolPage {
      run(value: string) {
        return value;
      }
    }
    const tool = action("run", "Run the operation.");
    registry.registerCompiledPom(
      ToolPage,
      manifest("ToolPage", { tools: [tool] })
    );
    const registration = registry.createPageRegistration(ToolPage);

    const definition = definitions.getPomDefinitions("ToolPage");
    const callable = registry.listRegisteredPomTools()[0];
    expect(definition).toEqual({
      definitions: [
        {
          name: "ToolPage",
          children: [],
          actions: [
            {
              name: "run",
              description: callable?.description,
              inputSchema: callable?.inputSchema,
              returnPoms: [],
            },
          ],
        },
      ],
    });

    registration.dispose();
  });
});
