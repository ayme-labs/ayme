import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  classifyEntries,
  moveFiles,
  parsePorcelain,
  setAsideAttempt,
} from "./labCheckout.ts";
import { labCheckoutCleanPrecondition } from "./preconditions.ts";

describe("parsePorcelain", () => {
  it("reads NUL-separated entries, paths with spaces included", () => {
    expect(
      parsePorcelain(
        "?? after-name-fill.yaml\0 M README.md\0?? notes/my file.md\0"
      )
    ).toEqual([
      { status: "??", path: "after-name-fill.yaml" },
      { status: " M", path: "README.md" },
      { status: "??", path: "notes/my file.md" },
    ]);
  });

  it("skips the source path that follows a rename", () => {
    expect(parsePorcelain("R  new.md\0old.md\0?? a.txt\0")).toEqual([
      { status: "R ", path: "new.md" },
      { status: "??", path: "a.txt" },
    ]);
  });

  it("is empty for a clean checkout", () => {
    expect(parsePorcelain("")).toEqual([]);
  });
});

describe("classifyEntries", () => {
  it("separates the agent's new files from modified tracked files and ignores ignored ones", () => {
    expect(
      classifyEntries(
        [
          { status: "??", path: "snap.yaml" },
          { status: " M", path: "README.md" },
          { status: "!!", path: "node_modules" },
          { status: "A ", path: "added.md" },
          { status: " D", path: "gone.md" },
        ],
        (gitPath) => `formbricks/${gitPath}`
      )
    ).toEqual({
      untracked: ["formbricks/snap.yaml"],
      modified: [
        "formbricks/README.md",
        "formbricks/added.md",
        "formbricks/gone.md",
      ],
    });
  });
});

describe("moveFiles", () => {
  it("moves files into the destination keeping their relative paths", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lab-checkout-"));
    const lab = path.join(dir, "lab");
    await mkdir(path.join(lab, "formbricks/notes"), { recursive: true });
    await writeFile(path.join(lab, "snap.yaml"), "a");
    await writeFile(path.join(lab, "formbricks/notes/b.md"), "b");

    await moveFiles(
      ["snap.yaml", "formbricks/notes/b.md"],
      path.join(dir, "agent-files"),
      lab
    );

    expect(
      await readFile(path.join(dir, "agent-files/snap.yaml"), "utf8")
    ).toBe("a");
    expect(
      await readFile(
        path.join(dir, "agent-files/formbricks/notes/b.md"),
        "utf8"
      )
    ).toBe("b");
    expect(existsSync(path.join(lab, "snap.yaml"))).toBe(false);
  });
});

describe("the lab checkout precondition", () => {
  it("passes on a clean checkout", async () => {
    const precondition = labCheckoutCleanPrecondition(() => ({
      untracked: [],
      modified: [],
    }));
    expect(await precondition.check()).toBeNull();
  });

  it("names the untracked and modified files", async () => {
    const precondition = labCheckoutCleanPrecondition(() => ({
      untracked: ["snap.yaml"],
      modified: ["formbricks/README.md"],
    }));
    const problem = await precondition.check();
    expect(problem).toContain("untracked snap.yaml");
    expect(problem).toContain("modified formbricks/README.md");
  });
});

/** The mission run's own cleanup, against a real git repository standing in for the lab app. */
describe("setAsideAttempt", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const dir of dirs.splice(0))
      await rm(dir, { recursive: true, force: true });
  });

  async function lab() {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lab-attempt-"));
    dirs.push(dir);
    const root = path.join(dir, "lab");
    await mkdir(path.join(root, "sub"), { recursive: true });
    await writeFile(path.join(root, "kept.txt"), "committed\n");
    await writeFile(path.join(root, "sub/gone.txt"), "committed too\n");
    const git = (...args: string[]) =>
      spawnSync(
        "git",
        ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args],
        { cwd: root, encoding: "utf8" }
      );
    git("init", "-q");
    git("add", ".");
    git("commit", "-q", "-m", "start");
    // The agent: edits one tracked file, deletes another, creates a file; a developer's file was there before.
    await writeFile(path.join(root, "kept.txt"), "the agent's edit\n");
    await rm(path.join(root, "sub/gone.txt"));
    await writeFile(path.join(root, "new.txt"), "agent");
    await writeFile(path.join(root, "developer.txt"), "mine");
    return {
      root,
      destination: path.join(dir, "agent-files"),
      read: () => ({
        untracked: ["developer.txt", "new.txt"],
        modified: ["kept.txt", "sub/gone.txt"],
      }),
      before: { untracked: ["developer.txt"], modified: [] },
    };
  }

  it("moves only the files the attempt created, and leaves tracked changes for a person when the run stands", async () => {
    const { root, destination, read, before } = await lab();
    const changes = await setAsideAttempt({
      before,
      destination,
      discard: false,
      read,
      root,
    });
    expect(changes).toEqual({
      untracked: ["new.txt"],
      modified: ["kept.txt", "sub/gone.txt"],
    });
    expect(await readFile(path.join(destination, "new.txt"), "utf8")).toBe(
      "agent"
    );
    expect(existsSync(path.join(root, "developer.txt"))).toBe(true);
    expect(await readFile(path.join(root, "kept.txt"), "utf8")).toBe(
      "the agent's edit\n"
    );
    expect(existsSync(path.join(destination, "kept.txt.diff"))).toBe(false);
  });

  it("saves a patch of each tracked change and restores the file when the attempt is thrown away", async () => {
    const { root, destination, read, before } = await lab();
    await setAsideAttempt({ before, destination, discard: true, read, root });
    expect(await readFile(path.join(root, "kept.txt"), "utf8")).toBe(
      "committed\n"
    );
    expect(await readFile(path.join(root, "sub/gone.txt"), "utf8")).toBe(
      "committed too\n"
    );
    expect(
      await readFile(path.join(destination, "kept.txt.diff"), "utf8")
    ).toContain("+the agent's edit");
    expect(
      await readFile(path.join(destination, "sub/gone.txt.diff"), "utf8")
    ).toContain("-committed too");
    expect(existsSync(path.join(root, "developer.txt"))).toBe(true);
  });
});
