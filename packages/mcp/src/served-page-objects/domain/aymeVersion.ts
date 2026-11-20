/** The package managers whose install command `ayme mcp` names. */
export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

/** Where and how a project installs a package. */
export type ProjectInstall = {
  packageManager: PackageManager;
  /** The folder of the project's `package.json`, where the command runs. */
  folder: string;
  /** Whether `folder` is a pnpm workspace's root, where pnpm needs `-w`. */
  workspaceRoot: boolean;
};

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
 * it names both versions and the command, and its folder, that installs
 * `mcp`'s. `project` is `undefined` when its version could not be read.
 */
export function aymeVersionMismatch({
  entry,
  project,
  mcp,
  install,
}: {
  entry: string;
  project: string | undefined;
  mcp: string;
  install: ProjectInstall;
}): string | undefined {
  if (project === mcp) return undefined;
  const has =
    project === undefined
      ? "@ayme-dev/ayme of a version it does not state"
      : `@ayme-dev/ayme ${project}`;
  const add = `${ADD_DEV_DEPENDENCY[install.packageManager]}${install.workspaceRoot ? " -w" : ""}`;
  return `Building the Page Objects entry ${entry} stopped: this project has ${has}; ayme mcp ${mcp} needs the same version. Run \`${add} @ayme-dev/ayme@${mcp}\` in ${install.folder}.`;
}
