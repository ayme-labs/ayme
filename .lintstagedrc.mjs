import { globSync, readFileSync } from "node:fs";
import path from "node:path";

// ESLint lints a staged file only where the workspace's own `lint` script
// does, so the hook never fails a file CI does not lint. ESLint runs from the
// root and resolves each file's workspace config, and the extensions are the
// ones the shared base config parses (no .vue or .svelte).
const root = import.meta.dirname;
const linted = globSync("{packages,apps}/*/package.json", {
  cwd: root,
}).flatMap((manifest) => {
  const lint = JSON.parse(readFileSync(path.join(root, manifest), "utf8"))
    .scripts?.lint;
  const [command, ...args] = lint?.split(/\s+/) ?? [];
  if (command !== "eslint") return [];
  const workspace = path.join(root, path.dirname(manifest));
  // The paths come before the options: `eslint src --max-warnings 0`.
  const end = args.findIndex((arg) => arg.startsWith("-"));
  return args
    .slice(0, end === -1 ? args.length : end)
    .map((target) => path.join(workspace, target) + path.sep);
});

export default {
  "*": "prettier --ignore-unknown --write",
  "*.{js,mjs,cjs,ts,tsx,mts,cts}": (files) => {
    const inLinted = files.filter((file) =>
      linted.some((dir) => file.startsWith(dir))
    );
    return inLinted.length === 0
      ? []
      : [
          `eslint --max-warnings 0 --no-warn-ignored ${inLinted.map((file) => JSON.stringify(file)).join(" ")}`,
        ];
  },
};
