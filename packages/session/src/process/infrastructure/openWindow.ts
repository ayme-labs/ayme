// Opening the person's default browser at the Inspector window, from the
// command that asked for it.
import { spawn } from "node:child_process";

/** The program that opens `url` and its arguments. */
type Opener = { readonly command: string; readonly args: readonly string[] };

/**
 * How `url` is opened in the person's default browser: with the program
 * the BROWSER variable names, as other development tools read it, or the
 * system's own opener; with none when BROWSER is "none".
 */
export function openerOf(
  url: string,
  { BROWSER }: { readonly BROWSER?: string | undefined },
  platform: NodeJS.Platform
): Opener | undefined {
  if (BROWSER === "none") return undefined;
  if (BROWSER) return { command: BROWSER, args: [url] };
  if (platform === "darwin") return { command: "open", args: [url] };
  // `start` takes its first quoted argument as the window's title.
  if (platform === "win32")
    return { command: "cmd", args: ["/c", "start", '""', url] };
  return { command: "xdg-open", args: [url] };
}

/** How long the command waits for the opener to end: the system's opener
 * ends at once, while a browser BROWSER names may stay open for as long as
 * it runs, so one still running then is taken to have started. */
const OPENER_WAIT_MS = 2_000;

/** Starts `opener` on its own and resolves with why it could not open the
 * window: it did not start, or it ended with a failure within `waitMs`.
 * It resolves with nothing once it ended well, or still runs then. */
export const startOpener = (
  { command, args }: Opener,
  waitMs = OPENER_WAIT_MS
) =>
  new Promise<string | undefined>((resolve) => {
    const child = spawn(command, [...args], {
      detached: true,
      stdio: "ignore",
    });
    let timer: NodeJS.Timeout | undefined;
    child.once("error", (error) => resolve(error.message));
    // The command waits for the opener, and lets go of one still running.
    child.once("spawn", () => {
      timer = setTimeout(() => {
        child.unref();
        resolve(undefined);
      }, waitMs);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve(
        code === 0
          ? undefined
          : `${command} exited with ${code === null ? `signal ${signal}` : `code ${code}`}.`
      );
    });
  });
