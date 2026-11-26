import type { SessionAnswer } from "@ayme-dev/session";

/** How a Session's answer is printed: its text, or itself as JSON for
 * `--json`; on stdout with exit code 0, or on stderr with 1 when it is a
 * failure. Every command of a Session prints this way. */
export function answerReport(
  answer: SessionAnswer,
  json: boolean
): { stream: "stdout" | "stderr"; text: string; exitCode: number } {
  return {
    stream: answer.ok ? "stdout" : "stderr",
    text: `${json ? JSON.stringify(answer) : answer.text}\n`,
    exitCode: answer.ok ? 0 : 1,
  };
}
