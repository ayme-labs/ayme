import {
  expect,
  freePort,
  serverAddress,
  startAgent,
  test,
  type Agent,
} from "./fixtures";

// Each App Process looks for a server on its test's port only, so it never
// pairs with a server another test or run has on the machine.

const TOOL = "peek.node.jobs";

/** Waits until the agent's server lists `name`. */
async function listed(agent: Agent, name: string) {
  await expect
    .poll(() => agent.toolNames(), { message: agent.log, timeout: 15_000 })
    .toContain(name);
}

/** The value a Peek Tool read from its one instance. */
async function valueOf(agent: Agent, name = TOOL) {
  const { text, isError } = await agent.call(name);
  expect(isError, text).toBe(false);
  return valueIn(text);
}

/** The value in a Peek Tool's result text. */
function valueIn(text: string) {
  const { instances } = JSON.parse(text) as {
    instances: { values: { value: string } }[];
  };
  expect(instances, text).toHaveLength(1);
  return instances[0]!.values.value;
}

test("an App Process pairs beside the paired page, the agent lists and calls both sides' tools, and the page stays paired", async ({
  agent,
  connect,
  startStandInAppProcess,
}) => {
  await connect("/");
  const { port } = await serverAddress(agent);

  startStandInAppProcess({ port, value: "server" });

  await listed(agent, TOOL);
  expect(await agent.toolNames()).toEqual(
    expect.arrayContaining(["snapshot", "read_text", TOOL])
  );
  expect(await valueOf(agent)).toBe("server");
  const { text: snapshot, isError } = await agent.call("snapshot");
  expect(isError, snapshot).toBe(false);
  expect(JSON.parse(snapshot).structure).toContain('heading "Groceries"');
  const { text: listing } = await agent.call("ayme_list_tools");
  expect(
    (JSON.parse(listing) as { name: string }[]).map(({ name }) => name)
  ).toEqual(expect.arrayContaining(["snapshot", TOOL]));
});

test("an App Process's tool goes when it exits, and the agent's next result says so", async ({
  agent,
  startStandInAppProcess,
}) => {
  const { port } = await serverAddress(agent);
  const appProcess = startStandInAppProcess({ port, value: "server" });
  await listed(agent, TOOL);
  await agent.call("ayme_list_tools");

  await appProcess.exit();

  await expect
    .poll(() => agent.toolNames(), { message: agent.log })
    .not.toContain(TOOL);
  const { note } = await agent.call("ayme_list_tools");
  expect(note).toContain(`Disappeared: ${TOOL}.`);
});

test("an App Process started before the agent pairs once the agent's server is up, and again after it restarts", async ({
  startStandInAppProcess,
}) => {
  const port = await freePort();
  startStandInAppProcess({ port, value: "server" });

  const agent = await startAgent("--port", String(port));
  try {
    await listed(agent, TOOL);
    expect(await valueOf(agent)).toBe("server");
  } finally {
    await agent.close();
  }

  const restarted = await startAgent("--port", String(port));
  try {
    await listed(restarted, TOOL);
    expect(await valueOf(restarted)).toBe("server");
  } finally {
    await restarted.close();
  }
});

test("an App Process pairs with the server its connect link names", async ({
  agent,
  startStandInAppProcess,
}) => {
  const { text: link } = await agent.call("ayme_connect", {
    url: "http://127.0.0.1/",
  });

  startStandInAppProcess({ link, value: "linked" });

  await listed(agent, TOOL);
  expect(await valueOf(agent)).toBe("linked");
});

test("of two App Processes that offer one tool name, the agent gets the first one's and is told, and the second logs it", async ({
  agent,
  startStandInAppProcess,
}) => {
  const { port } = await serverAddress(agent);
  const first = startStandInAppProcess({ port, value: "server" });
  await listed(agent, TOOL);

  const second = startStandInAppProcess({ port, value: "worker" });

  await expect
    .poll(() => second.output(), { timeout: 15_000 })
    .toContain(
      `[ayme] ${TOOL} is hidden: another App Process offers a tool with the same name. Rename one.`
    );
  const { text, note } = await agent.call(TOOL);
  expect(valueIn(text)).toBe("server");
  expect(note).toContain(
    `Hidden: ${TOOL}, because another App Process offers a tool with the same name`
  );

  await first.exit();
  await expect.poll(() => valueOf(agent).catch(() => "")).toBe("worker");
});

test("a Peek the page and an App Process add under one name gives peek.<name> and peek.node.<name>, each reading its own side", async ({
  agent,
  connect,
  startStandInAppProcess,
}) => {
  await connect("/?peek=jobs");
  const { port } = await serverAddress(agent);

  startStandInAppProcess({ port, peek: "jobs", value: "server" });

  await listed(agent, TOOL);
  expect(await agent.toolNames()).toContain("peek.jobs");
  expect(await valueOf(agent, "peek.jobs")).toBe("page");
  expect(await valueOf(agent, TOOL)).toBe("server");
});
