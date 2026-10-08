import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { classifyEntries, moveFiles, parsePorcelain } from "./labCheckout.ts";
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
