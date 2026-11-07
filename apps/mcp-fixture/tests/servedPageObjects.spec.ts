import { cp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { connectPage, expect, freePort, startAgent, test } from "./fixtures";

/**
 * The `.ayme` folder of a project that keeps its Page Objects outside the
 * app: the entry and the Page Object of `plain.html` it lists.
 */
const OUTSIDE_THE_APP = fileURLToPath(
  new URL("../outside/.ayme", import.meta.url)
);

/** The Page Object Tool of the entry's `PlainPage`. */
const PLAIN_PAGE_TOOL = "PlainPage.readNote";

test("a page without Ayme gets the Page Objects ayme mcp serves through the init script it writes", async ({
  context,
  page,
  baseURL,
}, testInfo) => {
  // A project folder beside the fixture's own packages, as a project's
  // `.ayme` sits beside its installed `@ayme-dev/ayme`.
  const project = testInfo.outputPath("project");
  await cp(OUTSIDE_THE_APP, join(project, ".ayme"), { recursive: true });
  const port = await freePort();
  const agent = await startAgent({ cwd: project }, "--port", String(port));
  try {
    const initScript = join(project, ".ayme", "init-script.js");
    expect(await readFile(initScript, "utf8")).toContain(
      `http://127.0.0.1:${port}/`
    );
    await context.addInitScript({ path: initScript });

    await connectPage(agent, page, `${baseURL}/plain.html`);
    await expect
      .poll(() => agent.pageToolNames(), { message: agent.log })
      .toContain(PLAIN_PAGE_TOOL);

    const { text, isError } = await agent.call(PLAIN_PAGE_TOOL);
    expect(isError, text).toBe(false);
    expect(text).toContain("does not run Ayme");
  } finally {
    await agent.close();
  }
});

test("--page-objects points ayme mcp at an entry elsewhere", async ({
  context,
  page,
  baseURL,
}, testInfo) => {
  const project = testInfo.outputPath("project");
  await cp(OUTSIDE_THE_APP, join(project, "agent"), { recursive: true });
  const agent = await startAgent(
    { cwd: project },
    "--port",
    String(await freePort()),
    "--page-objects",
    "agent/page-objects.ts"
  );
  try {
    await context.addInitScript({
      path: join(project, ".ayme", "init-script.js"),
    });

    await connectPage(agent, page, `${baseURL}/plain.html`);
    await expect
      .poll(() => agent.pageToolNames(), { message: agent.log })
      .toContain(PLAIN_PAGE_TOOL);
  } finally {
    await agent.close();
  }
});
