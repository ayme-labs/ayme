import { RunError } from "../../session/domain";

/**
 * Why a Run of the project's Node Host failed, as WebMCP publication tells
 * an agent today: the error's message, after its name unless that is plain
 * "Error", and how the Page Object Tree changed while the Run ran. The
 * error comes from the project's own copy of ayme, so it is read by its
 * fields, never by its class.
 */
export function runErrorOf(cause: unknown): RunError {
  if (!(cause instanceof Error)) return new RunError(String(cause));
  const { name, message } = cause;
  const { changes } = cause as { changes?: unknown };
  return new RunError(
    !name || name === "Error" ? message : `${name}: ${message}`,
    typeof changes === "string" && changes !== "" ? changes : undefined
  );
}
