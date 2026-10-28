import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import { fileURLToPath, URL } from "node:url";

for (const parent of ["worktree", ".worktree"]) {
  test(
    `serves the SPA within its build output under ${parent}`,
    { timeout: 10_000 },
    async (t) => {
      const temporary = await mkdtemp(path.join(os.tmpdir(), "angular-spa-"));
      t.after(() => rm(temporary, { recursive: true, force: true }));
      const cwd = path.join(temporary, parent);
      const root = path.join(cwd, "dist/spa/browser");
      await mkdir(path.join(root, ".private"), { recursive: true });
      const index = "<!doctype html><title>Angular SPA fixture</title>";
      await writeFile(path.join(root, "index.csr.html"), index);
      await writeFile(path.join(root, "main.js"), "console.log('asset');");
      await writeFile(path.join(root, ".env"), "hidden file secret");
      await writeFile(
        path.join(root, ".private/secret.txt"),
        "hidden directory secret"
      );
      await writeFile(path.join(cwd, "outside.txt"), "outside build secret");

      const child = spawn(
        process.execPath,
        [fileURLToPath(new URL("./serve-spa.mjs", import.meta.url))],
        {
          cwd,
          env: { ...process.env, HOST: "127.0.0.1", PORT: "0" },
          stdio: ["ignore", "pipe", "pipe"],
        }
      );
      t.after(async () => {
        if (child.exitCode !== null || child.signalCode !== null) return;
        const closed = once(child, "close");
        child.kill();
        await closed;
      });
      let errors = "";
      child.stderr.on("data", (chunk) => {
        errors += chunk;
      });
      const [output] = await Promise.race([
        once(child.stdout, "data"),
        once(child, "exit").then(([code]) => {
          throw new Error(`SPA server exited with code ${code}: ${errors}`);
        }),
      ]);
      const port = /listening on port (\d+)/.exec(output.toString())?.[1];
      assert.ok(port, `server did not report its port: ${output}`);

      for (const route of ["/", "/index.csr.html", "/other", "/nested/route"]) {
        await t.test(`index fallback for ${route}`, async () => {
          const response = await globalThis.fetch(
            `http://127.0.0.1:${port}${route}`
          );
          assert.equal(response.status, 200);
          assert.equal(await response.text(), index);
        });
      }
      await t.test("serves assets", async () => {
        const response = await globalThis.fetch(
          `http://127.0.0.1:${port}/main.js`
        );
        assert.equal(response.status, 200);
        assert.equal(await response.text(), "console.log('asset');");
      });
      for (const route of [
        "/.env",
        "/.private/secret.txt",
        "/outside.txt",
        "/..%2f..%2f..%2foutside.txt",
      ]) {
        await t.test(`does not expose ${route}`, async () => {
          const response = await globalThis.fetch(
            `http://127.0.0.1:${port}${route}`
          );
          assert.equal(await response.text(), index);
        });
      }
    }
  );
}
