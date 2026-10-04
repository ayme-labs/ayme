import { spawn } from "node:child_process";
import { createServer, type AddressInfo, type Server } from "node:net";

import { aymeCommand, expect, startAgent, test } from "./fixtures";

/** Listens on a free port of the loopback interface, outside the server's range. */
function occupyPort() {
  return new Promise<Server>((resolve) => {
    const server = createServer().listen(0, "127.0.0.1", () => resolve(server));
  });
}

const portOf = (server: Server) => (server.address() as AddressInfo).port;

test("--port makes the server listen on that port, and its connect link pairs the tab", async ({
  page,
  baseURL,
}) => {
  const placeholder = await occupyPort();
  const port = portOf(placeholder);
  await new Promise((resolve) => placeholder.close(resolve));
  const agent = await startAgent("--port", String(port));
  try {
    const { text: link } = await agent.call("ayme_connect", {
      url: `${baseURL}/`,
    });
    expect(link).toMatch(
      new RegExp(`^${baseURL}/#ayme=ws://127\\.0\\.0\\.1:${port}/[\\w-]+$`)
    );

    await page.goto(link);

    await expect
      .poll(() => agent.pageToolNames(), { message: agent.log })
      .toContain("snapshot");
  } finally {
    await agent.close();
  }
});

test("--port fails clearly when that port is taken, instead of taking another", async () => {
  const taken = await occupyPort();
  try {
    const server = spawn(
      process.execPath,
      [aymeCommand, "mcp", "--port", String(portOf(taken))],
      { stdio: ["pipe", "pipe", "pipe"] }
    );
    let stderr = "";
    server.stderr.on("data", (chunk: Buffer) => (stderr += String(chunk)));
    const exitCode = await new Promise<number | null>((resolve) =>
      server.once("exit", resolve)
    );

    expect(exitCode).toBe(1);
    expect(stderr).toContain(`Port ${portOf(taken)} is in use`);
  } finally {
    await new Promise((resolve) => taken.close(resolve));
  }
});
