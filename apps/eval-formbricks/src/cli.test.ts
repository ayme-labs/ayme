import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const cliModule = fileURLToPath(new URL("./cli.ts", import.meta.url));

/** Runs a harness whose `main` is `body`, with a grace of 200 ms, and something that never closes. */
function harness(body: string) {
  const started = Date.now();
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `const { runMain } = await import(${JSON.stringify(cliModule)});
       setInterval(() => {}, 1000);
       runMain(async () => { ${body} }, 200);`,
    ],
    { encoding: "utf8", timeout: 10_000 }
  );
  return { ...result, tookMs: Date.now() - started };
}

describe("runMain", () => {
  it("prints the error and ends with exit code 2, even when something would keep the harness alive", () => {
    const result = harness("throw new Error('the lab app went away');");
    expect(result.stderr).toContain("the lab app went away");
    expect(result.status).toBe(2);
    expect(result.tookMs).toBeLessThan(5_000);
  });

  it("ends with the exit code `main` set", () => {
    expect(harness("process.exitCode = 1;").status).toBe(1);
    expect(harness("").status).toBe(0);
  });
});
