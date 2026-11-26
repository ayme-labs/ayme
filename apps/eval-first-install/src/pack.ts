/**
 * Builds the ref under test into what a first-time user installs: the
 * `@ayme-dev/*` tarballs at a prerelease version, and the ref's `ayme` skill
 * and guide.
 *
 *   node src/pack.ts [--ref <ref>] [--out <dir>]
 *
 * The ref is checked out in a throwaway worktree under the main checkout's
 * .claude/worktrees/, which is removed afterwards. A ref that was packed
 * before is reused from results/packed/<sha>.
 */
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { repoRoot, resultsDir } from "./paths.ts";

export const DEFAULT_REF = "main";

/** The packages a first-time user's project installs, and the peers they pin. */
const PACKAGES = ["ayme", "mcp", "webmcp", "inspector"];

export type Packed = {
  dir: string;
  ref: string;
  sha: string;
  version: string;
  tarballs: string[];
};

// The ref's `pnpm install` runs the repo's root `prepare`, whose
// `lefthook install` would rewrite the hooks every worktree of this clone
// shares. Point git's hooks path at a throwaway folder for these commands.
const throwawayHooks = join(tmpdir(), "eval-first-install-hooks");
const run = (cmd: string, args: string[], cwd: string) =>
  execFileSync(cmd, args, {
    cwd,
    stdio: ["ignore", "inherit", "inherit"],
    env: {
      ...process.env,
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "core.hooksPath",
      GIT_CONFIG_VALUE_0: throwawayHooks,
    },
  });

const read = (cmd: string, args: string[], cwd: string) =>
  execFileSync(cmd, args, { cwd, encoding: "utf8" }).trim();

/** The commit the ref names, fetched from origin when origin has it. */
function resolveRef(ref: string, root: string): string {
  try {
    execFileSync("git", ["fetch", "--quiet", "origin", ref], {
      cwd: root,
      stdio: "ignore",
    });
    return read("git", ["rev-parse", "FETCH_HEAD"], root);
  } catch {
    return read("git", ["rev-parse", "--verify", `${ref}^{commit}`], root);
  }
}

function readPacked(dir: string): Packed | undefined {
  const meta = join(dir, "meta.json");
  if (!existsSync(meta)) return undefined;
  return JSON.parse(readFileSync(meta, "utf8")) as Packed;
}

export function pack(ref = DEFAULT_REF, outDir?: string): Packed {
  const root = repoRoot();
  const sha = resolveRef(ref, root);
  const short = sha.slice(0, 8);
  const dir = outDir ? resolve(outDir) : join(resultsDir, "packed", short);
  const existing = readPacked(dir);
  if (existing?.sha === sha) {
    console.log(`Reusing the packed ${ref} at ${short} from ${dir}`);
    return existing;
  }
  // The folder is emptied below, so it must be a pack or empty.
  if (!existing && existsSync(dir) && readdirSync(dir).length > 0)
    throw new Error(`${dir} holds files but no pack; name a new folder`);

  const worktree = join(
    root,
    ".claude",
    "worktrees",
    `eval-first-install-${short}`
  );
  rmSync(dir, { recursive: true, force: true });
  if (existsSync(worktree))
    run("git", ["worktree", "remove", "--force", worktree], root);
  run("git", ["worktree", "add", "--detach", worktree, sha], root);
  try {
    const base = JSON.parse(
      readFileSync(join(worktree, "packages/ayme/package.json"), "utf8")
    ).version.replace(/-.*$/, "");
    const version = `${base}-first-install.g${short}`;
    for (const name of PACKAGES) {
      const file = join(worktree, "packages", name, "package.json");
      const manifest = JSON.parse(readFileSync(file, "utf8"));
      manifest.version = version;
      writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
    }

    const filters = PACKAGES.flatMap((name) => [
      "--filter",
      `@ayme-dev/${name}...`,
    ]);
    run("pnpm", ["install", "--frozen-lockfile", ...filters], worktree);
    run(
      "pnpm",
      [...filters, "--workspace-concurrency=2", "run", "build"],
      worktree
    );

    const tarballDir = join(dir, "tarballs");
    mkdirSync(tarballDir, { recursive: true });
    for (const name of PACKAGES) {
      run(
        "pnpm",
        ["pack", "--pack-destination", tarballDir],
        join(worktree, "packages", name)
      );
    }
    cpSync(join(worktree, "skills", "ayme"), join(dir, "skill"), {
      recursive: true,
    });
    cpSync(join(worktree, "docs", "guide"), join(dir, "docs"), {
      recursive: true,
    });

    const packed: Packed = {
      dir,
      ref,
      sha,
      version,
      tarballs: readdirSync(tarballDir).filter((f) => f.endsWith(".tgz")),
    };
    writeFileSync(
      join(dir, "meta.json"),
      `${JSON.stringify(packed, null, 2)}\n`
    );
    console.log(`Packed ${ref} at ${short} as ${version} into ${dir}`);
    return packed;
  } finally {
    run("git", ["worktree", "remove", "--force", worktree], root);
    rmSync(throwawayHooks, { recursive: true, force: true });
  }
}

if (import.meta.filename === process.argv[1]) {
  const { values } = parseArgs({
    options: {
      ref: { type: "string" },
      out: { type: "string" },
    },
  });
  pack(values.ref ?? DEFAULT_REF, values.out);
}
