import { expect, holdCall, test, unanswered } from "./fixtures";

test("pairing a second tab switches to it, answers the first tab's calls and disconnects it", async ({
  agent,
  connect,
  context,
  page: first,
}) => {
  await connect();
  const { answer: call } = await holdCall(agent, first);
  const { text: link } = await agent.call("ayme_connect", {
    url: new URL("/other", first.url()).href,
  });
  const second = await context.newPage();

  await second.goto(link);

  const answer = unanswered(await call);
  expect(answer.error).toMatch(/^Another tab connected.*outcome is unknown/);
  await expect
    .poll(() => agent.pageToolNames())
    .toEqual(expect.arrayContaining(["read_other"]));
  await expect
    .poll(() =>
      first.evaluate(() => sessionStorage.getItem("ayme:agent-connection"))
    )
    .toBeNull();

  // The first tab does not take the connection back when it reloads.
  await first.reload();
  await expect(first.locator("html[data-fixture=ready]")).toBeAttached();
  await holdCall(agent, second);
  await expect(first.locator("html[data-holding]")).not.toBeAttached();
  expect(await agent.pageToolNames()).toContain("read_other");
});

test("a tab that reloads while another tab pairs does not take the connection back", async ({
  agent,
  connect,
  context,
  page: first,
}) => {
  await connect();
  const { answer: call } = await holdCall(agent, first);
  const { text: link } = await agent.call("ayme_connect", {
    url: new URL("/other", first.url()).href,
  });
  // The first tab is away, waiting to reconnect, when the second one pairs.
  await first.route("**/*", (route) =>
    setTimeout(() => void route.continue().catch(() => {}), 500)
  );
  const reloaded = first.reload();
  const second = await context.newPage();
  await second.goto(link);

  expect(unanswered(await call).error).toMatch(/^Another tab connected/);
  await reloaded;
  await expect(first.locator("html[data-fixture=ready]")).toBeAttached();
  await expect
    .poll(() =>
      first.evaluate(() => sessionStorage.getItem("ayme:agent-connection"))
    )
    .toBeNull();
  expect(await agent.pageToolNames()).toContain("read_other");
});
