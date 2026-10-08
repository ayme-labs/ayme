import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { expect } from "@playwright/test";
import { agentPort, server } from "@ayme-dev/example-certification/config";
import { exampleTest as test } from "@ayme-dev/example-certification/tests";
import { startAgent } from "@ayme-dev/mcp/testing";

// `next dev` never evaluates `instrumentation.ts` again, so the app adds its
// Peek from a module the root layout imports. After an edit to the module
// that Peek reads, the next request evaluates both again and the Peek
// answers with the new code and the state the page counts.
const rendersFile = fileURLToPath(
  new URL("../app/renders.ts", import.meta.url)
);
let original: string | undefined;
// A hook, unlike a `finally` in the test, also runs after a timeout.
test.afterEach(async () => {
  if (original !== undefined) await writeFile(rendersFile, original);
});

test("the server's Peek answers with the code of the latest edit", async ({
  request,
}) => {
  test.skip(server !== "dev", "Production builds do not rebuild.");
  original = await readFile(rendersFile, "utf8");
  const edited = original.replace("return renders;", "return -renders;");
  expect(edited).not.toBe(original);
  const agent = await startAgent("--port", String(agentPort));
  try {
    // The instance's count, when the Peek has exactly one instance.
    const readRenders = async () => {
      const { text, isError } = await agent.call("peek.node.renders");
      if (isError) return undefined;
      const { instances } = JSON.parse(text) as {
        instances: { values: { renders: number } }[];
      };
      return instances.length === 1 ? instances[0]!.values.renders : undefined;
    };
    await request.get("/");
    // The App Process started with the server and looks for this agent
    // every 3 s. The page counts its renders in the module the Peek reads.
    await expect
      .poll(readRenders, { message: agent.log, timeout: 15_000 })
      .toBeGreaterThan(0);

    await writeFile(rendersFile, edited);
    // Next evaluates the edited module on the request after it notices
    // the change.
    await expect
      .poll(
        async () => {
          await request.get("/");
          return readRenders();
        },
        { timeout: 30_000 }
      )
      .toBeLessThan(0);
  } finally {
    await agent.close();
  }
});
