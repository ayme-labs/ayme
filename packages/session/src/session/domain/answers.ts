import type { ListedTool, Listing, TabName } from "./listing";
import type { SessionAnswer, SessionEnd } from "./requests";
import type { RunAnswer, RunError } from "./run";

/** The first line of a listing: the Tab it describes. */
const tabLine = ({ url, title }: TabName) =>
  title ? `Tab: ${title} (${url})` : `Tab: ${url}`;

const NO_TOOLS = "This screen has no Page Object Tools.";

/** The last line of `ayme page-objects`: how many Page Object Tools the
 * screen has, and where they are listed. */
function toolCountLine(count: number): string {
  if (count === 0) return NO_TOOLS;
  return count === 1
    ? "This screen has 1 Page Object Tool: ayme tools lists it with its parameters."
    : `This screen has ${count} Page Object Tools: ayme tools lists them with their parameters.`;
}

/** The answer to `ayme page-objects`. */
export const pageObjectsAnswer = ({
  tab,
  pageObjectTree,
  tools,
}: Listing): SessionAnswer => ({
  ok: true,
  text: [tabLine(tab), pageObjectTree, toolCountLine(tools.length)].join("\n"),
  data: { tab, pageObjectTree, tools: tools.length },
});

/** The answer to the command that started a Session on a browser ayme
 * opened. */
export const openedAnswer = (address: string): SessionAnswer => ({
  ok: true,
  text: `A Session started on a new browser at ${address}.\nConnect your browser automation to that address. ayme close ends the Session and closes the browser.`,
  data: { address },
});

/** Why a Session that ended before its start was answered did not start. */
export function endedAtStart(end: SessionEnd): string {
  switch (end) {
    case "stopped":
      return "ayme close ended the Session before it started.";
    case "browser gone":
      return "The browser went away before the Session started.";
    case "start failed":
      return "The Session never started.";
  }
}

export const failed = (text: string): SessionAnswer => ({ ok: false, text });

/** A tool's lines in `ayme tools`: its name, whether it is unavailable and
 * why, its description, and its parameters on the line below. */
function toolLines({
  name,
  description,
  parameters,
  available,
  reason,
}: ListedTool): string[] {
  const unavailable = available
    ? ""
    : reason === undefined
      ? " (unavailable)"
      : ` (unavailable: ${reason})`;
  return [
    `${name}${unavailable}${description ? `: ${description}` : ""}`,
    `  parameters: ${JSON.stringify(parameters)}`,
  ];
}

/** The answer to `ayme tools`. */
export const toolsAnswer = ({ tab, tools }: Listing): SessionAnswer => ({
  ok: true,
  text: [
    tabLine(tab),
    ...(tools.length === 0 ? [NO_TOOLS] : tools.flatMap(toolLines)),
  ].join("\n"),
  data: { tab, tools },
});

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

const changesLines = (changes: string) => ["changes:", changes];

/** The answer to `ayme call`: the Run's short answer, a line for each of
 * its parts, and the tree of its changes last. */
export const callAnswer = (answer: RunAnswer): SessionAnswer => ({
  ok: true,
  text: [
    `settled: ${answer.settled}`,
    ...(answer.result === undefined
      ? []
      : [`result: ${JSON.stringify(answer.result)}`]),
    ...(answer.url === undefined ? [] : [`url: ${answer.url}`]),
    ...(answer.changes === undefined ? [] : changesLines(answer.changes)),
  ].join("\n"),
  data: answer,
});

/** The answer to `ayme call` when its Run was refused or failed, followed
 * by the tree of its changes as WebMCP publication tells them. */
export const runFailed = ({ message, changes }: RunError): SessionAnswer =>
  failed(
    changes === undefined
      ? message
      : [message, "", ...changesLines(changes)].join("\n")
  );

/** The answer to a command still waiting when the Session ended. */
export function endedBeforeAnswer(end: SessionEnd): SessionAnswer {
  switch (end) {
    case "stopped":
      return failed("The Session was closed before it answered this command.");
    case "browser gone":
      return failed(
        "The Session ended before it answered this command: its browser went away."
      );
    case "start failed":
      return failed("The Session never started.");
  }
}
