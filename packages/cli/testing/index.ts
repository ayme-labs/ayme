// Test support (ADR-0057): the built `ayme` command, as a consumer gets it,
// for end-to-end tests that run it as a child process.
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

/** The file of the built `ayme` command. */
export const aymeCommand = fileURLToPath(
  new URL("../dist/cli.mjs", import.meta.url)
);

/** What one run of the command printed, and its exit code. */
export type AymeRun = {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
};

/** Runs the built `ayme` with `args` in `cwd`, and resolves once it
 * exited. */
export function runAyme(
  args: readonly string[],
  { cwd, env }: { readonly cwd: string; readonly env?: NodeJS.ProcessEnv }
): Promise<AymeRun> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [aymeCommand, ...args],
      { cwd, env: env ?? process.env },
      (error, stdout, stderr) =>
        resolve({
          code: error ? Number(error.code ?? 1) : 0,
          stdout,
          stderr,
        })
    );
  });
}
