import { commandLine } from "./answers";
import type { SessionAnswer, SessionEnd } from "./requests";

type Nothing = Readonly<Record<never, never>>;

/** What `ayme inspect` and the Inspector window ask a Session. */
export type InspectorRequest =
  /** `ayme inspect`: where the Session serves its Inspector window, with
   * a one-use code made for this one opening (ADR-0072). */
  | { readonly window: Nothing }
  /** `ayme mcp`: the socket the Inspector an Agent App shows in its chat
   * connects to, with the token that admits it (ADR-0072). */
  | { readonly agentApp: Nothing }
  /** One call of the window on the Inspector's contract with the runtime:
   * `method` names one of the contract's methods, and `params` is its
   * argument, plain data the Session does not read. `tab` is the Tab the
   * window shows, as the Session told it; without it, the call is made on
   * the Tab the Session works on now. */
  | {
      readonly contract: {
        readonly method: string;
        readonly params?: unknown;
        readonly tab?: number;
      };
    };

/** What a Session tells its Inspector windows, in order. */
export type InspectorEvent =
  /** An event of the contract of the Tab the Session works on, plain data
   * the Session does not read. */
  | { readonly contract: unknown }
  /** The Tab the windows show from now on, by a number that rises on each
   * change, which the window's calls name: what a window showed before is
   * of the Tab before, and the contract's revisions start again. A window
   * hears it first when it starts listening. With `noTab`, the windows show
   * no Tab, as none is open or the tab list cannot be read: a window clears
   * what it showed, since no state of this Tab comes to replace it. */
  | { readonly tab: number; readonly noTab?: true }
  /** The Session ended: what the window says in place of the Inspector,
   * and what the view in an Agent App's chat says. Nothing follows it. */
  | { readonly ended: string; readonly inChat: string };

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

/** How long the code in the address `ayme inspect` gives admits a window:
 * long enough for a person to paste an address printed with BROWSER=none
 * into a browser, short enough that an address left in a terminal's
 * history no longer opens anything. */
export const OPENING_CODE_LIFETIME_MS = 5 * 60_000;

/** What a person who opens the address by hand needs to know of its code. */
const OPENS_ONCE = `The address opens one window, within ${OPENING_CODE_LIFETIME_MS / 60_000} minutes.`;

export const windowAnswer = (address: string, name: string): SessionAnswer => ({
  ok: true,
  text: `The Inspector of the Session ${name} is at ${address}. ${OPENS_ONCE}`,
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

/** The answer to `ayme inspect` once it asked the person's browser to open
 * the window of the Session named `name` at `address`: whether the browser
 * showed it, ayme cannot tell. */
export const windowOpened = (address: string, name: string): SessionAnswer => ({
  ok: true,
  text: `ayme asked your browser to open the Inspector of the Session ${name} at ${address}.`,
  data: { address },
});

/** The answer to `ayme inspect` when no browser could be asked to open the
 * window of the Session named `name`, for the reason `why`: a failure that
 * still says where the window is, to open by hand. */
export const windowNotOpened = (
  address: string,
  name: string,
  why: string
): SessionAnswer => ({
  ok: false,
  text: `The Inspector of the Session ${name} is at ${address}. ayme could not open it in a browser: ${why.replace(/\.$/, "")}. Open the address in a browser outside the Session's. ${OPENS_ONCE}`,
});

/** The answer to a window's call on the contract: what it answered. */
export const contractAnswer = (result: unknown): SessionAnswer => ({
  ok: true,
  text: "",
  data: result,
});

/** Why a window's call was refused before any work on the page: it names
 * a Tab the Session no longer shows, as the window has yet to hear. */
export const ANOTHER_TAB_SHOWN =
  "The Inspector shows another Tab now, so ayme did not carry out this call on the Tab the window showed.";

/** Why a window's Run of a tool that takes the Page Object Id `id` was
 * refused: the id is of the tab at `url`, not of the Tab the window shows. */
export const idNotOnShownTab = (id: string, url: string): string =>
  `${id} is a Page Object of the tab that shows ${url}, not of the Tab the Inspector shows.`;

/** Why `ayme inspect` finds no window: a Session served without one, as in
 * a test of its process. */
export const NO_WINDOW = "This Session serves no Inspector window.";

/** What the Inspector of the Session named `name` says once the Session
 * ended, by how it ended: in a window, and in an Agent App's chat. */
export function inspectorEnded(
  end: SessionEnd,
  name: string
): { readonly ended: string; readonly inChat: string } {
  const how = endedHow(end, name);
  const start = `Start a Session with ${commandLine(name, "open")} or ${commandLine(name, "attach")}`;
  return {
    ended: `${how} ${start}, then run ${commandLine(name, "inspect")} to inspect it.`,
    inChat: `${how} ${start}, then ask your agent to show the Inspector again.`,
  };
}

function endedHow(end: SessionEnd, name: string): string {
  switch (end) {
    case "stopped":
      return `The Session ${name} was closed.`;
    case "detached":
      return `ayme detach ended the Session ${name}.`;
    case "browser gone":
      return `The Session ${name} ended: its browser went away.`;
    case "start failed":
      return `The Session ${name} never started.`;
  }
}
