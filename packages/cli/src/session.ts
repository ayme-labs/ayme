import {
  askSession,
  listSessions,
  openSession,
  runSessionProcess,
  type SessionAnswer,
} from "@ayme-dev/session";

import { version } from "../package.json";
import { answerReport } from "./answer";
import type { Plan } from "./plan";
import { SESSION_PROCESS } from "./readCommand";

/** Whatever reaches a Session: `open` and `attach`, a request of the
 * folder's Session, `list`, or the Session's background process. */
export type SessionPlan = Extract<
  Plan,
  { kind: "open" | "attach" | "ask" | "list" | "session process" }
>;

async function answerOf(
  plan: Exclude<SessionPlan, { kind: "session process" }>
): Promise<SessionAnswer> {
  const projectDir = process.cwd();
  if (plan.kind === "list") return listSessions(projectDir);
  const place = { projectDir, name: plan.session };
  if (plan.kind === "ask") return askSession(place, plan.request);
  return openSession({
    ...place,
    request:
      plan.kind === "open" ? { open: plan.open } : { join: { cdp: plan.cdp } },
    // This same command, run as the Session's background process.
    processCommand: [process.argv[1]!, SESSION_PROCESS],
  });
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
