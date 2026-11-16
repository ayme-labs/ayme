import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = import.meta.dirname;
const WORKSPACE_DIR = /^(?:packages|apps)\/[^/]+(?=\/)/;

// The directories a workspace's own `lint` script lints, e.g. `src/` for
// `eslint src --max-warnings 0`, or none when it is not a workspace or has no
// ESLint lint script.
function lintedDirs(workspace) {
  const manifest = path.join(root, workspace, "package.json");
  if (!existsSync(manifest)) return [];
  const lint = JSON.parse(readFileSync(manifest, "utf8")).scripts?.lint;
  const [command, ...args] = lint?.split(/\s+/) ?? [];
  if (command !== "eslint") return [];
  // The paths come before the options.
  const end = args.findIndex((arg) => arg.startsWith("-"));
  return args
    .slice(0, end === -1 ? args.length : end)
    .map((target) => path.join(root, workspace, target) + path.sep);
}

// ESLint lints a staged file only where the workspace's own `lint` script
// does, so the hook never fails a file CI does not lint. Only the manifests
// of workspaces with staged files are read. ESLint runs from the root and
// resolves each file's workspace config; the extensions are the ones the
// shared base config parses (no .vue or .svelte).
export default {
  "*": "prettier --ignore-unknown --write",
  "*.{js,mjs,cjs,ts,tsx,mts,cts}": (files) => {
    const linted = new Map();
    const inLinted = files.filter((file) => {
      const workspace = WORKSPACE_DIR.exec(path.relative(root, file))?.[0];
      if (workspace === undefined) return false;
      if (!linted.has(workspace)) linted.set(workspace, lintedDirs(workspace));
      return linted.get(workspace).some((dir) => file.startsWith(dir));
    });
    return inLinted.length === 0
      ? []
      : [
          `eslint --max-warnings 0 --no-warn-ignored ${inLinted.map((file) => JSON.stringify(file)).join(" ")}`,
        ];
  },
};
