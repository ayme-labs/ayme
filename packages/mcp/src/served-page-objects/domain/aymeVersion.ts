/** The package managers whose install command `ayme mcp` names. */
export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

const ADD_DEV_DEPENDENCY: Record<PackageManager, string> = {
  npm: "npm install -D",
  pnpm: "pnpm add -D",
  yarn: "yarn add -D",
  bun: "bun add -d",
};

/**
 * Why `ayme mcp` does not build the Page Objects `entry` with the project's
 * `@ayme-dev/ayme`, or `undefined` when its version, `project`, is `mcp`'s
 * own. The packages are released together, so only the same version pairs:
 * it names both versions and the command that installs `mcp`'s. `project`
 * is `undefined` when its version could not be read.
 */
export function aymeVersionMismatch({
  entry,
  project,
  mcp,
  packageManager,
}: {
  entry: string;
  project: string | undefined;
  mcp: string;
  packageManager: PackageManager;
}): string | undefined {
  if (project === mcp) return undefined;
  const has =
    project === undefined
      ? "@ayme-dev/ayme of a version it does not state"
      : `@ayme-dev/ayme ${project}`;
  return `Building the Page Objects entry ${entry} stopped: this project has ${has}; ayme mcp ${mcp} needs the same version. Run \`${ADD_DEV_DEPENDENCY[packageManager]} @ayme-dev/ayme@${mcp}\`.`;
}
