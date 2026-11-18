import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

import { aymeCommand, expect, freePort, test } from "./fixtures";

// An agent may ask `server/discover` (revision 2026-07-28) and then open
// with `initialize` (an older revision) anyway. No SDK client sends that
// sequence, so this test writes the raw lines to `ayme mcp`'s stdin.
test("after server/discover and then initialize, the server serves the older revision and ayme_connect still pairs a page", async ({
  page,
  baseURL,
}) => {
  const server = spawn(
    process.execPath,
    [aymeCommand, "mcp", "--port", String(await freePort())],
    { stdio: ["pipe", "pipe", "pipe"] }
  );
  let log = "";
  server.stderr.on("data", (chunk: Buffer) => (log += String(chunk)));
  const exited = new Promise<number | null>((resolve) =>
    server.once("exit", (code) => resolve(code))
  );
  const answers = new Map<number, Record<string, unknown>>();
  createInterface({ input: server.stdout }).on("line", (line) => {
    const message = JSON.parse(line) as { id?: number };
    if (typeof message.id === "number") answers.set(message.id, message);
  });
  let id = 0;
  const send = (method: string, params?: Record<string, unknown>) =>
    server.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method, ...(params && { params }) })}\n`
    );
  /** Sends a request and returns its answer. */
  const request = async (method: string, params?: Record<string, unknown>) => {
    const sent = ++id;
    server.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: sent, method, ...(params && { params }) })}\n`
    );
    await expect
      .poll(() => answers.has(sent), { message: `${method}. Log:\n${log}` })
      .toBe(true);
    return answers.get(sent)!;
  };
  const clientInfo = { name: "raw-agent", version: "0.0.0" };
  try {
    expect(
      await request("server/discover", {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": clientInfo,
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      })
    ).toHaveProperty(
      "result.supportedVersions",
      expect.arrayContaining(["2026-07-28"])
    );
    expect(
      await request("initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo,
      })
    ).toHaveProperty("result.protocolVersion", "2025-11-25");
    send("notifications/initialized");
    const toolNames = async () =>
      (
        (await request("tools/list")) as {
          result: { tools: { name: string }[] };
        }
      ).result.tools.map(({ name }) => name);
    expect(await toolNames()).toContain("ayme_connect");

    const connected = (await request("tools/call", {
      name: "ayme_connect",
      arguments: { url: new URL("/", baseURL).href },
    })) as { result: { content: { text: string }[] } };
    await page.goto(connected.result.content[0]!.text);

    await expect
      .poll(toolNames, { message: `The page never paired. Log:\n${log}` })
      .toContain("snapshot");
  } finally {
    // The process stops when the agent closes stdin.
    server.stdin.end();
    expect(await exited).toBe(0);
  }
});
