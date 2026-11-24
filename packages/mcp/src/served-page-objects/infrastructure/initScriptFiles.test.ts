import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { writeInitScript } from "./initScriptFiles";

// The real file system, but for one moment no test can otherwise reach:
// between the creation of a file and the first write to it, where another
// tool may write to the same file.
const betweenCreationAndFirstWrite = vi.hoisted(() => ({
  run: undefined as (() => Promise<void>) | undefined,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  const writeFile: typeof real.writeFile = async (file, data, options) => {
    const { run } = betweenCreationAndFirstWrite;
    const flag = typeof options === "object" ? options?.flag : undefined;
    if (run === undefined || flag === undefined || typeof file !== "string")
      return real.writeFile(file, data, options);
    betweenCreationAndFirstWrite.run = undefined;
    const handle = await real.open(file, flag);
    try {
      await run();
      await handle.writeFile(data);
    } finally {
      await handle.close();
    }
  };
  return { ...real, writeFile };
});

let folder: string;
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "ayme-init-script-"));
});
afterEach(() => rm(folder, { recursive: true, force: true }));

const read = (name: string) => readFile(join(folder, "ayme", name), "utf8");

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

it("creates a .gitignore that ignores the init script", async () => {
  await writeInitScript({ folder, port: 9411 });

  expect((await read(".gitignore")).split("\n")).toContain("init-script.js");
});

it("adds the init script to a .gitignore without replacing the user's lines", async () => {
  await mkdir(join(folder, "ayme"));
  await writeFile(join(folder, "ayme", ".gitignore"), "notes/\n# mine\n*.log");

  await writeInitScript({ folder, port: 9411 });

  expect(await read(".gitignore")).toBe(
    "notes/\n# mine\n*.log\ninit-script.js\n"
  );
});

it("leaves a .gitignore that already ignores the init script as it is", async () => {
  await mkdir(join(folder, "ayme"));
  await writeFile(
    join(folder, "ayme", ".gitignore"),
    "/init-script.js\nnotes/\n"
  );

  await writeInitScript({ folder, port: 9411 });
  await writeInitScript({ folder, port: 9412 });

  expect(await read(".gitignore")).toBe("/init-script.js\nnotes/\n");
});

it("keeps the line the recorder adds between the creation of the .gitignore and its first write", async () => {
  betweenCreationAndFirstWrite.run = () =>
    appendFile(join(folder, "ayme", ".gitignore"), "recordings/\n");

  await writeInitScript({ folder, port: 9411 });

  expect((await read(".gitignore")).split("\n")).toEqual(
    expect.arrayContaining(["recordings/", "init-script.js"])
  );
});

it("writes the init script all the same when the .gitignore cannot be read, as a folder of its name cannot", async () => {
  await mkdir(join(folder, "ayme", ".gitignore"), { recursive: true });

  await expect(writeInitScript({ folder, port: 9411 })).resolves.toBe(
    join(folder, "ayme", "init-script.js")
  );
  expect(await read("init-script.js")).toContain("9411");
});
