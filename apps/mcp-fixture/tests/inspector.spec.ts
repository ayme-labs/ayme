import { selectors } from "@playwright/test";
import {
  Inspector,
  registerInspectorSelectors,
} from "@ayme-dev/inspector/testing";

import { addItemRef, expect, serverAddress, test } from "./fixtures";

// The page's Inspector shows the App Processes' Peek tools in the Node
// section of its Peek tools, and runs them through the agent's server. The
// Inspector renders into a closed shadow root; its page objects reach it
// through these selectors.
test.beforeAll(() => registerInspectorSelectors(selectors));

const TOOL = "peek.node.jobs";

test("an App Process's Peek tool shows in the Inspector's Node section while it is paired, and running it returns the process's value", async ({
  agent,
  connect,
  page,
  startAppProcess,
}) => {
  await connect("/?inspector&peek=cart");
  const { port } = await serverAddress(agent);
  const appProcess = startAppProcess({ port, value: "server" });
  const inspector = new Inspector(page);
  await inspector.open();
  await inspector.navigator.showLens("Tools");

  await expect
    .poll(() => inspector.navigator.tools.peekSections(), { timeout: 15_000 })
    .toEqual({ Browser: ["peek.cart"], Node: [TOOL] });
  await (await inspector.tool(TOOL)).run();

  // A Run in the page's Run log, the Inspector's, with no Interactions:
  // the tool ran in the App Process, not on the page.
  const run = inspector.runs.latest(TOOL);
  await expect.poll(() => run.status()).toBe("Succeeded");
  expect(await run.caller()).toEqual({ icon: "Run by you from the Inspector" });
  expect(await run.interactions.count()).toBe(0);
  expect(JSON.parse((await run.resultText()) ?? "")).toEqual({
    name: "jobs",
    instances: [{ values: { value: "server" } }],
  });

  await appProcess.exit();

  await expect
    .poll(() => inspector.navigator.tools.peekSections())
    .toEqual({ Browser: ["peek.cart"] });
});

test("an agent's call over the Ayme MCP server is an ayme-mcp Run in the page's Run log, which the Inspector shows", async ({
  agent,
  connect,
  page,
}) => {
  await connect("/?inspector");
  const ref = await addItemRef(agent);
  const inspector = new Inspector(page);
  await inspector.open();

  const { isError } = await agent.call("read_text", { ref });

  expect(isError).toBe(false);
  const run = inspector.runs.latest("read_text");
  await expect.poll(() => run.status()).toBe("Succeeded");
  expect(await run.caller()).toEqual({
    icon: "Run by an agent through Ayme MCP",
  });
  expect(JSON.parse((await run.arguments.textContent()) ?? "")).toEqual({
    ref,
  });
});
