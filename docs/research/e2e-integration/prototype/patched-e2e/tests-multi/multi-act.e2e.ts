import { expect, test, unique } from "e2e";

/**
 * Three acts per test, so one Claude Code session serves several steps.
 * Both tests open with the same step; each touches the projects flow and the counter.
 */
test("creates a project, counts to two, and creates another", async ({
  app,
  agent,
  screen,
}) => {
  await app.open("/");
  const run = Date.now().toString(36);
  const first = `E2E multi first ${run}`;
  const second = `E2E multi second ${run}`;
  await agent.act("create a project named {name}", {
    params: { name: unique(first) },
  });
  await expect(screen.getByText(first, { exact: true })).toBeVisible();
  await agent.act("increment the counter twice");
  await expect(screen.getByRole("region", "Counter")).toContainText("Count: 2");
  await agent.act("create a project named {name}", {
    params: { name: unique(second) },
  });
  await expect(screen.getByText(second, { exact: true })).toBeVisible();
});

test("creates a project, unmounts the counter, and mounts it again", async ({
  app,
  agent,
  screen,
}) => {
  await app.open("/");
  const name = `E2E multi mount ${Date.now().toString(36)}`;
  await agent.act("create a project named {name}", {
    params: { name: unique(name) },
  });
  await expect(screen.getByText(name, { exact: true })).toBeVisible();
  await agent.act("remove the counter from the page");
  await expect(screen.getByRole("button", "Mount counter")).toBeVisible();
  await agent.act("bring the counter back and increment it once");
  await expect(screen.getByRole("region", "Counter")).toContainText("Count: 1");
});
