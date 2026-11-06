import { afterEach, expect, it } from "vitest";

import { registerCompiledPom } from "../page-objects/application";
import { probeRegisteredPomMembers } from "../page-objects/infrastructure";
import { demoModeOptions } from "../runs/infrastructure";
import type { InspectorEvent } from "../shared";
import { createAyme, type AymePage } from "../index";
import { inlineInspectorContract } from "./inlineInspectorContract";

// The contract the runtime serves inline, over a real started session in
// Chromium: every command result and event is plain data, and survives a JSON
// round trip unchanged.

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  stop = undefined;
  document.body.innerHTML = "";
});

const roundTrip = (value: unknown) => JSON.parse(JSON.stringify(value));

it("serves the started session's state, commands and events as plain JSON", async () => {
  document.body.innerHTML = '<button id="save">Save</button>';
  const contract = inlineInspectorContract();
  const events: InspectorEvent[] = [];
  const unsubscribe = contract.subscribe({
    onEvent: (event) => events.push(event),
    onError: (error) => {
      throw error;
    },
  });
  const ayme = createAyme();
  stop = ayme.start();

  const before = await contract.getState();
  const run = await contract.runTool({ name: "snapshot", by: "inspector" });
  const highlight = await contract.highlight({
    layer: "hover",
    refs: [],
  });
  const missing = await contract.runTool({ name: "no-such-tool" });
  const results = [before, run, highlight, missing];
  unsubscribe();

  expect(before.tools.map((tool) => tool.name)).toContain("snapshot");
  expect(run.state.runs).toEqual([
    expect.objectContaining({ tool: "snapshot", by: "inspector" }),
  ]);
  expect(missing.error).toEqual(expect.any(String));
  expect(events.length).toBeGreaterThan(0);
  for (const value of [...results, ...events])
    expect(roundTrip(value)).toStrictEqual(value);
  const revisions = events.flatMap((event) =>
    event.type === "state" ? [event.state.revision] : []
  );
  expect(revisions).toEqual([...revisions].sort((a, b) => a - b));
});

it("answers one look at the page and the registry as plain JSON, with refs for the page's elements", async () => {
  document.body.innerHTML = '<button id="save">Save</button><input value="x">';
  const contract = inlineInspectorContract();
  const ayme = createAyme();
  stop = ayme.start();

  const look = await contract.look();
  const text = await contract.pomDefinitionText({});
  const state = await contract.getState();

  expect(look.refs.length).toBeGreaterThan(0);
  expect(look.projected.roots.length).toBeGreaterThan(0);
  expect(look.controls).toEqual({
    [look.refs.find((ref) => look.controls[ref]?.value === "x")!]: {
      value: "x",
    },
  });
  expect(typeof text).toBe("string");
  expect(state.pageObjects).toEqual([]);
  expect(state.pomDefinitions).toEqual([]);
  for (const value of [look, text, state])
    expect(roundTrip(value)).toStrictEqual(value);
});

it("leaves the Inspector's own host out of the look, so the page never shows it", async () => {
  document.body.innerHTML = `
    <main><h1>Consumer application</h1></main>
    <div data-ayme-inspector-host><p>Inspector panel text</p></div>`;
  const contract = inlineInspectorContract();
  const ayme = createAyme();
  stop = ayme.start();

  const look = await contract.look();
  const text = JSON.stringify(look.projected);

  expect(text).toContain("Consumer application");
  expect(text).not.toContain("Inspector panel text");
});

class Form {
  constructor(readonly page: AymePage) {}
  get saveButton() {
    return this.page.getByRole("button", { name: "Save" });
  }
  async save() {
    await this.saveButton.click();
  }
}

it("answers a registered Page Object, its members by path and its definition text as plain JSON", async () => {
  document.body.innerHTML = '<button id="save">Save</button>';
  registerCompiledPom(Form, {
    className: "Form",
    components: [],
    members: [{ memberName: "saveButton", kind: "locator", access: "getter" }],
    tools: [{ methodName: "save", toolName: "Form.save", parameters: [] }],
  });
  const contract = inlineInspectorContract();
  const ayme = createAyme();
  ayme.pom.register(Form);
  stop = () => {
    ayme.pom.unregister(Form);
    stopSession();
  };
  const stopSession = ayme.start();
  await probeRegisteredPomMembers();

  const state = await contract.getState();
  const look = await contract.look();
  const text = await contract.pomDefinitionText({ names: ["Form"] });

  const [form] = state.pageObjects;
  expect(form?.manifest.className).toBe("Form");
  expect(form?.presentPaths).toEqual([""]);
  expect(form?.tools.map((tool) => tool.name)).toEqual(["Form.save"]);
  const target = look.targets.find(({ path }) => path === "Form.saveButton");
  expect(target?.ref).toBeDefined();
  expect(look.targetsByRef[target!.ref!]).toEqual(["Form.saveButton"]);
  expect(text).toContain("Form");
  for (const value of [state, look, text])
    expect(roundTrip(value)).toStrictEqual(value);
});

it("serves the latest recorded page state without recording a look", async () => {
  document.body.innerHTML = '<button id="save">Save</button>';
  const contract = inlineInspectorContract();
  const ayme = createAyme();
  stop = ayme.start();
  await ayme.tools.run("snapshot", {});

  document.body.innerHTML = '<button id="save">Discard</button>';
  const look = await contract.look();
  const recorded = await contract.recordedPageState();

  // The Inspector's look sees the page now; the record is the agent's call.
  expect(JSON.stringify(look.projected)).toContain("Discard");
  expect(JSON.stringify(recorded?.projected)).toContain("Save");
  expect(JSON.stringify(recorded?.projected)).not.toContain("Discard");
  expect(recorded?.refs.length).toBeGreaterThan(0);
  expect(roundTrip(recorded)).toStrictEqual(recorded);
});

it("asks the runtime for Demo Mode on the Inspector's behalf, and withdraws the ask", async () => {
  const contract = inlineInspectorContract();
  const ayme = createAyme();
  stop = ayme.start();

  const on = await contract.demo({ on: true });
  const paced = demoModeOptions().beforeActionMs;
  await contract.demo({ on: true });
  const off = await contract.demo({ on: false });

  expect(paced).toBeGreaterThan(0);
  expect(demoModeOptions()).toEqual({});
  for (const value of [on, off]) expect(roundTrip(value)).toStrictEqual(value);
  void ayme;
});
