import type { Dialog } from "./dialog";
import type { ListedTool, Listing, TabName } from "./listing";
import type { SessionAnswer, SessionEnd } from "./requests";
import type { RunAnswer, RunError } from "./run";
import type { SessionStartError } from "./startError";

/** The `ayme` command line of `word` for the Session named `name`, for a
 * sentence that tells the user to run it. It names the Session even by
 * the default name, so that it reaches this Session however AYME_SESSION is
 * set where it runs. */
export const commandLine = (name: string, word: string): string =>
  `ayme -s=${name} ${word}`;

const TAB_LINE = "Tab: ";

/** The first line of a listing: the Tab it describes. */
const tabLine = ({ url, title }: TabName) =>
  title ? `${TAB_LINE}${title} (${url})` : `${TAB_LINE}${url}`;

/** The first line of what `reason` says, which a stack may follow. */
const firstLine = (reason: string) => reason.split("\n")[0]!;

/** The build line while the last finished build failed: its first error,
 * whole, on one line, or else the first line of the reason (rule 7). */
export const rebuildFailedLine = ({ first, message }: SessionStartError) =>
  `Page Object rebuild failed. Keeping the current Page Objects. ${first === undefined ? firstLine(message) : first.replace(/\s*\n\s*/g, " ")}`;

/** The build line while a Tab could not take the last good build it was
 * handed, for `reason`. */
export const swapRefusedLine = (reason: string) =>
  `Page Object rebuild failed on this Tab. Keeping its current Page Objects. ${firstLine(reason)}`;

/** The build line while the source cannot be watched, for `reason`. */
export const unwatchedLine = (reason: string) =>
  `The Page Objects' source cannot be watched, so an edit may not be rebuilt. ${firstLine(reason)}`;

/** `answer`, a listing's or the reason it read no page, with `line`, the
 * build line, after its Tab line, in its text and its data alike. An
 * answer without a Tab line, such as "no tab is open", gets none, since the
 * line describes the Page Objects a Tab shows. */
export function withBuildLine(
  answer: SessionAnswer,
  line: string | undefined
): SessionAnswer {
  if (line === undefined || !answer.text.startsWith(TAB_LINE)) return answer;
  const [tab, ...rest] = answer.text.split("\n");
  const text = [tab, line, ...rest].join("\n");
  return answer.ok
    ? {
        ...answer,
        text,
        data: { ...(answer.data as object), buildFailing: line },
      }
    : { ok: false, text };
}

const NO_TOOLS = "This screen has no Page Object Tools.";

/** `--tab` naming the Tab at `url`, single-quoted so that it pastes into a
 * POSIX shell whatever the URL holds. */
const tabOption = (url: string) => `--tab='${url.replaceAll("'", "'\\''")}'`;

/** The last line of `ayme page-objects` of the Session named `name`: how
 * many Page Object Tools the screen has, and where they are listed, also
 * when it has none; on the Tab `--tab` named, when it named one. */
function toolCountLine(
  count: number,
  name: string,
  tab: string | undefined
): string {
  const tools =
    commandLine(name, "tools") +
    (tab === undefined ? "" : ` ${tabOption(tab)}`);
  return count === 1
    ? `This screen has 1 Page Object Tool: ${tools} lists it with its parameters.`
    : `This screen has ${count} Page Object Tools: ${tools} lists them with their parameters.`;
}

/** The answer to `ayme page-objects` of the Session named `name`, asked
 * for the Tab `--tab` named, when it named one. */
export const pageObjectsAnswer = (
  { tab, pageObjectTree, tools }: Listing,
  name: string,
  named?: string
): SessionAnswer => ({
  ok: true,
  text: [
    tabLine(tab),
    pageObjectTree,
    toolCountLine(tools.length, name, named),
  ].join("\n"),
  data: { tab, pageObjectTree, tools: tools.length },
});

/** The answer to the command that started the Session named `name` on a
 * browser ayme opened. */
export const openedAnswer = (address: string, name: string): SessionAnswer => ({
  ok: true,
  text: `A Session started on a new browser at ${address}.\nConnect your browser automation to that address. ${commandLine(name, "close")} ends the Session and closes the browser.`,
  data: { address },
});

/** The answer to the command that started the Session named `name` on a
 * browser it joined. */
export const joinedAnswer = (address: string, name: string): SessionAnswer => ({
  ok: true,
  text: `A Session started on the browser at ${address}.\n${commandLine(name, "detach")} ends the Session and leaves the browser running.`,
  data: { address },
});

/** Why `ayme detach` is refused on the Session named `name`, whose browser
 * ayme opened. */
export const detachRefused = (name: string): SessionAnswer => ({
  ok: false,
  text: `ayme opened this Session's browser, so ayme detach would leave it without an owner. End the Session and close the browser with ${commandLine(name, "close")}.`,
});

/** Why a Session that ended before its start was answered did not start. */
export function endedAtStart(end: SessionEnd): string {
  switch (end) {
    case "stopped":
      return "ayme close ended the Session before it started.";
    case "detached":
      return "ayme detach ended the Session before it started.";
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
  destructive,
}: ListedTool): string[] {
  const mark = destructive ? " destructive" : "";
  const unavailable = available
    ? ""
    : reason === undefined
      ? " (unavailable)"
      : ` (unavailable: ${reason})`;
  return [
    `${name}${mark}${unavailable}${description ? `: ${description}` : ""}`,
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

/** The answer to a command that ended the Session, by how it ended and
 * whether ayme had opened its browser. */
export function endAnswer(end: SessionEnd, opened: boolean): SessionAnswer {
  switch (end) {
    case "stopped":
    case "detached":
      return {
        ok: true,
        text: opened
          ? "The Session ended and its browser was closed."
          : "The Session ended. Its browser keeps running.",
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

/** The answer to a command whose answer could not be made or written, such
 * as a Run's whose returned value throws when it is turned into text. */
export const unanswerable = (why: string): SessionAnswer =>
  failed(
    `ayme could not write the answer to this command: ${why.replace(/\.$/, "")}.`
  );

/** The answer to a command still waiting when the Session ended. */
export function endedBeforeAnswer(end: SessionEnd): SessionAnswer {
  switch (end) {
    case "stopped":
      return failed("The Session was closed before it answered this command.");
    case "detached":
      return failed(
        "ayme detach ended the Session before it answered this command."
      );
    case "browser gone":
      return failed(
        "The Session ended before it answered this command: its browser went away."
      );
    case "start failed":
      return failed("The Session never started.");
  }
}

/** The answer to `ayme call` of the Session named `name` when its
 * `--params` is not JSON. */
export const paramsNotJson = (why: string, name: string): SessionAnswer =>
  failed(
    `--params is not JSON: ${why.replace(/\.$/, "")}. Give the tool's input as one JSON object, as ${commandLine(name, "tools")} prints its parameters.`
  );

/** The answer to `ayme call` when the file its `--params @<file>` names
 * cannot be read. */
export const paramsUnreadable = (file: string, why: string): SessionAnswer =>
  failed(
    `--params @${file} names a file ayme cannot read: ${why.replace(/\.$/, "")}.`
  );

/** The answer to `ayme call` when its `--params @<file>` names something
 * other than a regular file, such as a named pipe or a folder. */
export const paramsNotAFile = (file: string): SessionAnswer =>
  failed(
    `--params @${file} names something that is not a regular file. Give a file of JSON.`
  );

/** The answer to `ayme call` when the file its `--params @<file>` names is
 * larger than `limit` bytes, the most ayme reads. */
export const paramsTooLarge = (file: string, limit: number): SessionAnswer =>
  failed(
    `--params @${file} names a file larger than ${limit / (1024 * 1024)} MB, the most ayme reads for a tool's input.`
  );

/** Why a command that needs a Tab is answered with none (rule 9). */
export const NO_TAB_OPEN =
  "No tab is open in the Session's browser. Open one with your browser automation, then run ayme again.";

/** Why a command waiting on a Tab was answered without what it asked for:
 * the Tab closed meanwhile. */
export const TAB_CLOSED =
  "The tab was closed before ayme answered this command.";

/** Why `--tab` named no open Tab of the Session named `name`: the URLs the
 * open Tabs show. */
export const noTabShows = (
  url: string,
  shown: readonly string[],
  name: string
): string =>
  `No tab of the Session's browser shows ${url}. --tab takes the URL a tab shows, as the first line of ${commandLine(name, "page-objects")} prints it. The open tabs show: ${shown.join(", ")}.`;

/** Why `ayme call` was refused when its Page Object Id is on another Tab
 * than the one `--tab` names: the id chooses the Tab. */
export const idOnAnotherTab = (id: string, on: string, named: string): string =>
  `${id} is a Page Object of the tab that shows ${on}, not of the one that shows ${named}. Leave out --tab: the Page Object Id chooses the tab.`;

/** The dialog `dialog` names itself in the first sentence of every answer
 * while it is open. */
function dialogSentences({ type, message, defaultValue }: Dialog): string {
  const article = /^[aeiou]/i.test(type) ? "An" : "A";
  return [
    `${article} ${type} dialog is open on the tab: ${JSON.stringify(message)}.`,
    ...(defaultValue
      ? [`Its default value is ${JSON.stringify(defaultValue)}.`]
      : []),
  ].join(" ");
}

/** Why a command was answered without the page, before it started: a
 * dialog is open on its Tab (rule 5). Nothing of it ran, so it can be run
 * again. */
export const dialogOpen = (dialog: Dialog): string =>
  `${dialogSentences(dialog)} Answer it with your browser automation, then run this command again.`;

/** Why a listing of the Tab at `url` was answered without the page: a
 * dialog is open on the Tab. It still starts with the Tab line, and names
 * the Tab by its URL, since its title is the page's, which the dialog
 * holds (rule 5). */
export const dialogOpenInListing = (url: string, dialog: Dialog): string =>
  `${tabLine({ url, title: "" })}\n${dialogOpen(dialog)}`;

/** Why a Run ended at a dialog once its action had started (rule 4): part
 * of the action may have happened, so the agent checks the page rather than
 * run it again. */
export const dialogOpenAtRun = (dialog: Dialog): string =>
  `${dialogSentences(dialog)} Answer it with your browser automation. The action stopped there: ayme refuses its further calls on the page, however the dialog is answered. Check the page before you choose the next step.`;
