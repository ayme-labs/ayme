import { commandLine } from "./answers";
import type { SessionAnswer, SessionEnd } from "./requests";

type Nothing = Readonly<Record<never, never>>;

/** What `ayme inspect` and the Inspector window ask a Session. */
export type InspectorRequest =
  /** `ayme inspect`: where the Session serves its Inspector window. */
  | { readonly window: Nothing }
  /** `ayme mcp`: the socket the Inspector an Agent App shows in its chat
   * connects to, with the token that admits it (ADR-0072). */
  | { readonly agentApp: Nothing }
  /** One call of the window on the Inspector's contract with the runtime,
   * on the Tab the Session works on: `method` names one of the contract's
   * methods, and `params` is its argument, plain data the Session does not
   * read. */
  | {
      readonly contract: {
        readonly method: string;
        readonly params?: unknown;
      };
    };

/** What a Session tells its Inspector windows, in order. */
export type InspectorEvent =
  /** An event of the contract of the Tab the Session works on, plain data
   * the Session does not read. */
  | { readonly contract: unknown }
  /** The Session works on another Tab from now on: what the window showed
   * is of the Tab before, and the contract's revisions start again. */
  | { readonly newTab: Nothing }
  /** The Session ended: what the window says in place of the Inspector.
   * Nothing follows it. */
  | { readonly ended: string };

/** Whether a Tab at `url` shows the Inspector window served at `window`:
 * any page of the window's server is the window's. */
export function showsWindow(url: string, window: string): boolean {
  return originOf(url) === originOf(window);
}

const originOf = (url: string) => {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
};

/** The answer to `ayme inspect` of the Session named `name`, whose window
 * is at `address`. */
export const windowAnswer = (address: string, name: string): SessionAnswer => ({
  ok: true,
  text: `The Inspector of the Session ${name} is at ${address}.`,
  data: { address },
});

/** The answer to `ayme mcp` of the Session named `name`, whose window
 * admits the view in an Agent App's chat at `socket`. Its sentence, which
 * the model reads, holds no token. */
export const agentAppAnswer = (
  socket: string,
  name: string
): SessionAnswer => ({
  ok: true,
  text: `The Inspector of the Session ${name} shows in this chat when your Agent App shows MCP Apps. ${commandLine(name, "inspect")} opens it in a browser window.`,
  data: { socket },
});

/** The Caller ayme's runtime names a Run from the Inspector with:
 * `callers.inspector` of `@ayme-dev/ayme`, whose type this package does not
 * import, since it runs the project's own ayme. */
export const INSPECTOR_CALLER = "inspector";

/** The answer to `ayme inspect` once it opened the window of the Session
 * named `name` at `address` in the person's default browser. */
export const windowOpened = (address: string, name: string): SessionAnswer => ({
  ok: true,
  text: `The Inspector of the Session ${name} opened in your default browser at ${address}.`,
  data: { address },
});

/** The answer to `ayme inspect` when the person's default browser did not
 * open at the window of the Session named `name`, for the reason `why`. */
export const windowNotOpened = (
  address: string,
  name: string,
  why: string
): SessionAnswer => ({
  ok: true,
  text: `The Inspector of the Session ${name} is at ${address}. ayme could not open your default browser: ${why.replace(/\.$/, "")}. Open the address in a browser outside the Session's.`,
  data: { address },
});

/** The answer to a window's call on the contract: what it answered. */
export const contractAnswer = (result: unknown): SessionAnswer => ({
  ok: true,
  text: "",
  data: result,
});

/** Why `ayme inspect` finds no window: a Session served without one, as in
 * a test of its process. */
export const NO_WINDOW = "This Session serves no Inspector window.";

/** What the Inspector window of the Session named `name` says once the
 * Session ended, by how it ended. */
export function windowEnded(end: SessionEnd, name: string): string {
  const again = `Start a Session with ayme open or ayme attach, then run ${commandLine(name, "inspect")} to inspect it.`;
  switch (end) {
    case "stopped":
      return `The Session ${name} was closed. ${again}`;
    case "detached":
      return `ayme detach ended the Session ${name}. ${again}`;
    case "browser gone":
      return `The Session ${name} ended: its browser went away. ${again}`;
    case "start failed":
      return `The Session ${name} never started. ${again}`;
  }
}
