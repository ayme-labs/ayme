import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  askCall,
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

/** Whatever reaches a Session but `ayme mcp`, which stays to serve the
 * Agent App. */
export type SessionPlan = Exclude<Plan, { kind: "print" | "capture" | "mcp" }>;

/** The Inspector's external build, which the build puts in an `inspector`
 * folder beside the command's own file, as it does the recorder window. */
export const inspectorScript = (commandFile: string): string =>
  join(dirname(fileURLToPath(commandFile)), "inspector", "external.mjs");

async function answerOf(
  plan: Exclude<SessionPlan, { kind: "session process" }>
): Promise<SessionAnswer> {
  const projectDir = process.cwd();
  if (plan.kind === "list") return listSessions(projectDir);
  const place = { projectDir, name: plan.session };
  if (plan.kind === "ask") return askSession(place, plan.request);
  if (plan.kind === "call")
    return askCall(place, plan.tool, plan.params, plan.tab);
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
    return runSessionProcess(
      JSON.parse(plan.options),
      version,
      inspectorScript(import.meta.url)
    );
  const { stream, text, exitCode } = answerReport(
    await answerOf(plan),
    plan.json
  );
  process[stream].write(text);
  return exitCode;
}
