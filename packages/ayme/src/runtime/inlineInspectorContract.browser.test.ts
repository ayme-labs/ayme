import { afterEach, expect, it } from "vitest";

import type { InspectorEvent } from "../shared";
import { createAyme } from "../index";
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
