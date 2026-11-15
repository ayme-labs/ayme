import { globSync } from "node:fs";
import path from "node:path";

// ESLint runs from the root and resolves each file's own workspace config,
// so it lints only files in workspaces that have one, and only the
// extensions the shared base config parses (no .vue or .svelte).
const root = import.meta.dirname;
const linted = globSync("{packages,apps}/*/eslint.config.*", { cwd: root }).map(
  (config) => path.join(root, path.dirname(config)) + path.sep
);

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
