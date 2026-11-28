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
])("notices %s changed in place after the snapshot", (_, options, change) => {
  const snapshot = snapshotRuntimeOptions(options);
  expect(sameRuntimeOptions(options, snapshot)).toBe(true);
  change(options);
  expect(sameRuntimeOptions(options, snapshot)).toBe(false);
});

it("compares objects field by field", () => {
  expect(
    sameRuntimeOptions(
      { webMCP: { enabled: true, toolNamePrefix: undefined } },
      { webMCP: { enabled: true } }
    )
  ).toBe(true);
  expect(sameRuntimeOptions({ webMCP: {} }, {})).toBe(false);
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
  it.each<[string, AymeOptions["inspector"], boolean, boolean]>([
    ["unset", undefined, false, false],
    ["false", false, false, false],
    ["true", true, true, false],
    ["{ demo: true }", { demo: true }, true, true],
    ["{ demo: false }", { demo: false }, true, false],
  ])("%s reads as on %s, demo %s", (_, inspector, on, demo) => {
    expect(inspectorSetting({ inspector })).toEqual({ on, demo });
  });

  it("keeps a session's options the same only while whether it is on and demo are", () => {
    expect(
      sameRuntimeOptions({ inspector: true }, { inspector: { demo: false } })
    ).toBe(true);
    expect(
      sameRuntimeOptions({ inspector: true }, { inspector: { demo: true } })
    ).toBe(false);
    expect(sameRuntimeOptions({ inspector: true }, { inspector: false })).toBe(
      false
    );
  });
});
