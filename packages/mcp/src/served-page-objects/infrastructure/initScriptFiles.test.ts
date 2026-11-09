import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, it } from "vitest";

import { writeInitScript } from "./initScriptFiles";

let folder: string;
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "ayme-init-script-"));
});
afterEach(() => rm(folder, { recursive: true, force: true }));

const read = (name: string) => readFile(join(folder, ".ayme", name), "utf8");

it("writes an init script that loads the served code from the port of the server that wrote it", async () => {
  await writeInitScript({ folder, port: 9411 });

  const script = await read("init-script.js");
  expect(script).toContain('"http://127.0.0.1:9411/page-objects/"');
  expect(script).not.toContain("9350");
});

it("names the port it is given anew each time it writes", async () => {
  await writeInitScript({ folder, port: 9411 });
  await writeInitScript({ folder, port: 40123 });

  const script = await read("init-script.js");
  expect(script).toContain("http://127.0.0.1:40123/");
  expect(script).not.toContain("9411");
});

it("writes an init script that leaves WebMCP publication off unless asked", async () => {
  await writeInitScript({ folder, port: 9411 });

  expect(await read("init-script.js")).not.toMatch(/webmcp/i);
});

it("with webMCP, writes an init script that turns WebMCP publication on", async () => {
  await writeInitScript({ folder, port: 9411, webMCP: true });

  expect(await read("init-script.js")).toContain("webMCP: { enabled: true }");
});

it("creates a .gitignore that ignores the init script", async () => {
  await writeInitScript({ folder, port: 9411 });

  expect((await read(".gitignore")).split("\n")).toContain("init-script.js");
});

it("adds the init script to a .gitignore without replacing the user's lines", async () => {
  await mkdir(join(folder, ".ayme"));
  await writeFile(join(folder, ".ayme", ".gitignore"), "notes/\n# mine\n*.log");

  await writeInitScript({ folder, port: 9411 });

  expect(await read(".gitignore")).toBe(
    "notes/\n# mine\n*.log\ninit-script.js\n"
  );
});

it("leaves a .gitignore that already ignores the init script as it is", async () => {
  await mkdir(join(folder, ".ayme"));
  await writeFile(
    join(folder, ".ayme", ".gitignore"),
    "/init-script.js\nnotes/\n"
  );

  await writeInitScript({ folder, port: 9411 });
  await writeInitScript({ folder, port: 9412 });

  expect(await read(".gitignore")).toBe("/init-script.js\nnotes/\n");
});
