import { describe, expect, it } from "vitest";
import type { CustomTool } from "../tools/application";
import type { AymeOptions } from "./runtime";
import {
  inspectorSetting,
  sameRuntimeOptions,
  snapshotRuntimeOptions,
} from "./runtimeOptions";

class Model {}
class Other {}
const tool = {} as CustomTool;

it.each<[string, AymeOptions, (options: AymeOptions) => void]>([
  ["customTools", { customTools: [tool] }, (o) => o.customTools!.push(tool)],
  [
    "pageObjects",
    { pageObjects: [Model] },
    (o) => {
      (o.pageObjects as (typeof Model)[])[0] = Other;
    },
  ],
  [
    "webMCP",
    { webMCP: { enabled: true } },
    (o) => {
      o.webMCP!.toolNamePrefix = "app_";
    },
  ],
  [
    "inspector",
    { inspector: { demo: false } },
    (o) => {
      (o.inspector as { demo: boolean }).demo = true;
    },
  ],
  [
    "agentConnection",
    { agentConnection: { port: 9351 } },
    (o) => {
      (o.agentConnection as { port: number }).port = 9352;
    },
  ],
])("notices %s changed in place after the snapshot", (_, options, change) => {
  const snapshot = snapshotRuntimeOptions(options);
  expect(sameRuntimeOptions(options, snapshot)).toBe(true);
  change(options);
  expect(sameRuntimeOptions(options, snapshot)).toBe(false);
});

it("compares objects field by field", () => {
  expect(
    sameRuntimeOptions(
      { agentConnection: { port: 9351, link: undefined } },
      { agentConnection: { port: 9351 } }
    )
  ).toBe(true);
  expect(sameRuntimeOptions({ webMCP: {} }, {})).toBe(false);
  expect(
    sameRuntimeOptions({ agentConnection: true }, { agentConnection: {} })
  ).toBe(false);
});

it("keeps an instance by reference rather than copying its own fields", () => {
  class Config {
    get enabled() {
      return true;
    }
  }
  const webMCP = new Config();
  const snapshot = snapshotRuntimeOptions({ webMCP });
  expect(snapshot.webMCP).toBe(webMCP);
  expect(sameRuntimeOptions({ webMCP }, { webMCP: new Config() })).toBe(false);
});

describe("the inspector option", () => {
  it.each<[string, AymeOptions["inspector"], string, boolean]>([
    ["unset", undefined, "off", false],
    ["false", false, "off", false],
    ["true", true, "inline", false],
    ["{ demo: true }", { demo: true }, "inline", true],
    ["{ demo: false }", { demo: false }, "inline", false],
    ["an inline placement", { placement: "inline" }, "inline", false],
    ["an external placement", { placement: "external" }, "external", false],
    [
      "an external placement with demo",
      { placement: "external", demo: true },
      "external",
      true,
    ],
  ])("%s reads as %s, demo %s", (_, inspector, placement, demo) => {
    expect(inspectorSetting({ inspector })).toEqual({ placement, demo });
  });

  it("keeps a session's options the same only while its placement and demo are", () => {
    expect(
      sameRuntimeOptions({ inspector: true }, { inspector: { demo: false } })
    ).toBe(true);
    expect(
      sameRuntimeOptions(
        { inspector: true },
        { inspector: { placement: "inline" } }
      )
    ).toBe(true);
    expect(
      sameRuntimeOptions(
        { inspector: true },
        { inspector: { placement: "external" } }
      )
    ).toBe(false);
    expect(
      sameRuntimeOptions(
        { inspector: { placement: "external" } },
        { inspector: { placement: "external", demo: true } }
      )
    ).toBe(false);
  });

  it("notices the placement changed in place after the snapshot", () => {
    const options: AymeOptions = { inspector: { placement: "inline" } };
    const snapshot = snapshotRuntimeOptions(options);

    (options.inspector as { placement: string }).placement = "external";

    expect(sameRuntimeOptions(options, snapshot)).toBe(false);
  });
});
