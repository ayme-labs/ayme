import {
  askCall,
  askSession,
  openSession,
  runSessionProcess,
  type SessionAnswer,
} from "@ayme-dev/session";

import { version } from "../package.json";
import { answerReport } from "./answer";
import type { Plan } from "./plan";
import { SESSION_PROCESS } from "./readCommand";

/** Whatever reaches a Session: `open`, a request of the folder's Session,
 * a call, or the Session's background process. */
export type SessionPlan = Extract<
  Plan,
  { kind: "open" | "ask" | "call" | "session process" }
>;

function answerOf(
  plan: Exclude<SessionPlan, { kind: "session process" }>
): Promise<SessionAnswer> {
  const projectDir = process.cwd();
  switch (plan.kind) {
    case "open":
      return openSession({
        projectDir,
        request: { open: plan.open },
        // This same command, run as the Session's background process.
        processCommand: [process.argv[1]!, SESSION_PROCESS],
      });
    case "call":
      return askCall(projectDir, plan.tool, plan.params);
    case "ask":
      return askSession(projectDir, plan.request);
  }
}

/** Carries out a plan that reaches a Session, and resolves with the exit
 * code. */
export async function session(plan: SessionPlan): Promise<number> {
  if (plan.kind === "session process")
    return runSessionProcess(JSON.parse(plan.options), version);
  const { stream, text, exitCode } = answerReport(
    await answerOf(plan),
    plan.json
  );
  process[stream].write(text);
  return exitCode;
}
