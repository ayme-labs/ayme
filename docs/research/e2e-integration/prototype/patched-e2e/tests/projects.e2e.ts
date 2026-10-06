import { expect, test, unique } from "e2e";

/** Three tests that share one step: each creates a project, then checks it is listed. */
for (const variant of ["first", "second", "third"]) {
  test(`creates a ${variant} project`, async ({ app, agent, screen }) => {
    await app.open("/");
    const name = `E2E ${variant} ${Date.now().toString(36)}`;
    await agent.act("create a project named {name}", {
      params: { name: unique(name) },
    });
    await expect(screen.getByText(name, { exact: true })).toBeVisible();
  });
}
