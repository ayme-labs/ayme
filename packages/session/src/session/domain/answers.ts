import type { SessionAnswer, SessionEnd } from "./requests";

/** The answer to the command that started a Session on a browser ayme
 * opened. */
export const openedAnswer = (address: string): SessionAnswer => ({
  ok: true,
  text: `A Session started on a new browser at ${address}.\nConnect your browser automation to that address. ayme close ends the Session and closes the browser.`,
  data: { address },
});

export const failed = (text: string): SessionAnswer => ({ ok: false, text });

/** The answer to a request of a kind the Session does not have, such as one
 * from an `ayme` command of another version. */
export const unknownRequest = failed(
  "ayme does not know this request. Update ayme, or run ayme --help."
);

/** The answer to a command that ended the Session, by how it ended. */
export function endAnswer(end: SessionEnd): SessionAnswer {
  switch (end) {
    case "stopped":
      return {
        ok: true,
        text: "The Session ended and its browser was closed.",
      };
    case "browser gone":
      return failed("The Session had already ended: its browser went away.");
    case "start failed":
      return failed("The Session never started.");
  }
}
