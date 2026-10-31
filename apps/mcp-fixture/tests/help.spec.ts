import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { aymeCommand, expect, test } from "./fixtures";

const run = promisify(execFile);

test.describe("--help", () => {
  for (const args of [["--help"], ["mcp", "--help"], ["-h"]]) {
    test(`ayme ${args.join(" ")} prints the usage text to stdout and exits 0`, async () => {
      const { stdout, stderr } = await run(process.execPath, [
        aymeCommand,
        ...args,
      ]);

      expect(stdout).toContain("Usage: ayme mcp [--port <port>]");
      expect(stderr).toBe("");
    });
  }

  test("an unknown option fails with the message and usage on stderr", async () => {
    const failure = await run(process.execPath, [
      aymeCommand,
      "mcp",
      "--nope",
    ]).catch(
      (error: { code: number; stdout: string; stderr: string }) => error
    );

    expect(failure).toMatchObject({ code: 1, stdout: "" });
    expect(failure).toHaveProperty(
      "stderr",
      expect.stringContaining("Unknown option '--nope'")
    );
  });
});
