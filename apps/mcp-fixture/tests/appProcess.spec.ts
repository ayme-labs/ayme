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

/** The value the stand-in App Process's tool returned. */
async function valueOf(agent: Agent, name = TOOL) {
  const { text, isError } = await agent.call(name);
  expect(isError, text).toBe(false);
  return (JSON.parse(text) as { value: string }).value;
}

test("an App Process pairs beside the paired page, the agent lists and calls both sides' tools, and the page stays paired", async ({
  agent,
  connect,
  startAppProcess,
}) => {
  await connect("/");
  const { port } = await serverAddress(agent);

  startAppProcess({ port, value: "server" });

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
  startAppProcess,
}) => {
  const { port } = await serverAddress(agent);
  const appProcess = startAppProcess({ port, value: "server" });
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
  startAppProcess,
}) => {
  const port = await freePort();
  startAppProcess({ port, value: "server" });

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
  startAppProcess,
}) => {
  const { text: link } = await agent.call("ayme_connect", {
    url: "http://127.0.0.1/",
  });

  startAppProcess({ link, value: "linked" });

  await listed(agent, TOOL);
  expect(await valueOf(agent)).toBe("linked");
});

test("of two App Processes that offer one tool name, the agent gets the first one's and is told, and the second logs it", async ({
  agent,
  startAppProcess,
}) => {
  const { port } = await serverAddress(agent);
  const first = startAppProcess({ port, value: "server" });
  await listed(agent, TOOL);

  const second = startAppProcess({ port, value: "worker" });

  await expect
    .poll(() => second.output(), { timeout: 15_000 })
    .toContain(
      `[ayme] ${TOOL} is hidden: another App Process offers a tool with the same name. Rename one.`
    );
  const { text, note } = await agent.call(TOOL);
  expect(JSON.parse(text)).toEqual({ value: "server" });
  expect(note).toContain(
    `Hidden: ${TOOL}, because another App Process offers a tool with the same name`
  );

  await first.exit();
  await expect.poll(() => valueOf(agent).catch(() => "")).toBe("worker");
});
