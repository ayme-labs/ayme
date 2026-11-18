import { spawn } from "node:child_process";

import { aymeCommand, expect, freePort, test } from "./fixtures";

// An agent that crashed no longer reads `ayme mcp`'s stdout. The server must
// stop then, not keep the page port and the paired page for nobody.
test("the server stops once writing to the agent fails", async () => {
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
  try {
    server.stdout.destroy();
    // Its answer is the write that fails. Stdin stays open.
    server.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "gone-agent", version: "0.0.0" },
        },
      })}\n`
    );
    const stillRunning = new Promise<"still running">((resolve) =>
      setTimeout(() => resolve("still running"), 10_000)
    );
    expect(await Promise.race([exited, stillRunning]), `Log:\n${log}`).toBe(0);
  } finally {
    server.kill();
  }
});
