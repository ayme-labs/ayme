import {
  passThroughPlaywrightCli,
  projectPlaywrightCli,
} from "../playwright/infrastructure";

/**
 * Runs `install <arguments>` on the project's own Playwright, in the
 * project's folder, with the terminal as its own: the same browsers its own
 * `npx playwright install` puts where its recorder finds them. Resolves with
 * the exit code.
 */
export async function runInstall(options: {
  readonly projectDir: string;
  readonly args: readonly string[];
}): Promise<number> {
  const cli = projectPlaywrightCli(options.projectDir);
  if (!cli) {
    process.stderr.write(
      `No Playwright is installed in ${options.projectDir}. A browser is installed by the project's own Playwright: install it there, for example with "npm install -D @playwright/test".\n`
    );
    return 1;
  }
  return passThroughPlaywrightCli(
    cli,
    ["install", ...options.args],
    options.projectDir
  );
}
