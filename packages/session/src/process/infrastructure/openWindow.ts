// Opening the person's default browser at the Inspector window, from the
// command that asked for it, outside the Session's browser.
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

/** Starts `opener` on its own, and resolves once it started: with why it
 * could not, or with nothing. The command does not wait for the browser. */
export const startOpener = ({ command, args }: Opener) =>
  new Promise<string | undefined>((resolve) => {
    const child = spawn(command, [...args], {
      detached: true,
      stdio: "ignore",
    });
    child.once("error", (error) => resolve(error.message));
    child.once("spawn", () => {
      child.unref();
      resolve(undefined);
    });
  });
