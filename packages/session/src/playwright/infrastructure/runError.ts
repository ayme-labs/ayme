import { ActionNotStarted, RunError } from "../../session/domain";
import { LeftUncaught } from "./runUncaught";

/**
 * Why a Run of the project's Node Host failed, as WebMCP publication tells
 * an agent today: the error's message, after its name unless that is plain
 * "Error", and how the Page Object Tree changed while the Run ran. The
 * error comes from the project's own copy of ayme, so it is read by its
 * fields, never by its class. One its code left uncaught keeps the Run's
 * work, still going. A Run whose action had not `acted` is an
 * {@link ActionNotStarted}.
 */
export function runErrorOf(cause: unknown, acted = true): RunError {
  const Failed = acted ? RunError : ActionNotStarted;
  if (cause instanceof LeftUncaught) {
    const { message, changes } = runErrorOf(cause.error);
    return new Failed(message, changes, cause.ended);
  }
  if (!(cause instanceof Error)) return new Failed(String(cause));
  const { name, message } = cause;
  const { changes } = cause as { changes?: unknown };
  return new Failed(
    !name || name === "Error" ? message : `${name}: ${message}`,
    typeof changes === "string" && changes !== "" ? changes : undefined
  );
}
