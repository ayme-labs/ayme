import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { aymeCommand, expect, freePort, startAgent, test } from "./fixtures";

const run = promisify(execFile);

/** Runs `ayme inspect` and gives what it printed, whether it succeeded or not. */
async function inspect(...args: string[]) {
  return run(process.execPath, [aymeCommand, "inspect", ...args]).catch(
    (error: { code: number; stdout: string; stderr: string }) => error
  );
}

test("ayme inspect prints the URL ayme_inspect returns, and the server serves the Inspector there", async () => {
  const port = await freePort();
  const agent = await startAgent("--port", String(port));
  try {
    const { text: url, isError } = await agent.call("ayme_inspect");
    expect(isError).toBe(false);

    const printed = await inspect("--port", String(port));

    expect(url).toBe(`http://127.0.0.1:${port}/inspector`);
    expect(printed).toMatchObject({ stdout: `${url}\n`, stderr: "" });
    const page = await fetch(url);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("/inspector/external.mjs");
    const script = await fetch(`${url}/external.mjs`);
    expect(script.status).toBe(200);
    expect(script.headers.get("content-type")).toContain("text/javascript");
  } finally {
    await agent.close();
  }
});

test("ayme inspect says so when no server runs", async () => {
  const failure = await inspect("--port", String(await freePort()));

  expect(failure).toMatchObject({ code: 1, stdout: "" });
  expect(failure).toHaveProperty(
    "stderr",
    expect.stringContaining("No Ayme MCP server is running")
  );
});

test.describe("without @ayme-dev/inspector installed", () => {
  // A resolve hook that finds no such package, as a project that did not
  // install the optional peer.
  const withoutInspector = [
    "--import",
    `data:text/javascript,${encodeURIComponent(`
      import { register } from "node:module";
      register("data:text/javascript," + encodeURIComponent(\`
        export async function resolve(specifier, context, next) {
          if (specifier.startsWith("@ayme-dev/inspector"))
            throw Object.assign(new Error("Cannot find package " + specifier), { code: "ERR_MODULE_NOT_FOUND" });
          return next(specifier, context);
        }
      \`));
    `)}`,
  ];

  test("ayme inspect prints an install hint and exits 1", async () => {
    const failure = await run(process.execPath, [
      ...withoutInspector,
      aymeCommand,
      "inspect",
    ]).catch(
      (error: { code: number; stdout: string; stderr: string }) => error
    );

    expect(failure).toMatchObject({ code: 1, stdout: "" });
    expect(failure).toHaveProperty(
      "stderr",
      expect.stringContaining("npm install --save-dev @ayme-dev/inspector")
    );
  });

  test("ayme_inspect answers with the same hint", async () => {
    const port = await freePort();
    const { StdioClientTransport } =
      await import("@modelcontextprotocol/sdk/client/stdio.js");
    const { Client } =
      await import("@modelcontextprotocol/sdk/client/index.js");
    const client = new Client({ name: "ayme-e2e", version: "0.0.0" });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [...withoutInspector, aymeCommand, "mcp", "--port", String(port)],
        stderr: "pipe",
      })
    );
    try {
      const result = await client.callTool({
        name: "ayme_inspect",
        arguments: {},
      });

      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain(
        "npm install --save-dev @ayme-dev/inspector"
      );
    } finally {
      await client.close();
    }
  });
});
