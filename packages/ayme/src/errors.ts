/**
 * What an Ayme failure is about. Browser action failures are not Ayme errors:
 * Playwright Lite's errors pass through with their own name.
 */
export type AymeErrorKind = "input" | "resolution" | "runtime";

/** A failure Ayme raises itself. `name` is the class name. */
export abstract class AymeError extends Error {
  abstract override readonly name: string;
  abstract readonly kind: AymeErrorKind;
}

/** The caller's arguments are wrong. */
export class ToolInputError extends AymeError {
  override readonly name = "ToolInputError";
  readonly kind = "input";
}

/** A Structural Ref or a Page Object instance does not match the live page. */
export class RefResolutionError extends AymeError {
  override readonly name = "RefResolutionError";
  readonly kind = "resolution";
}

/**
 * A `RuntimeStateError` that callers recognise without matching its message.
 * `active-owner`: another runtime session is already started in the document,
 * or in the Node process, as its App Process.
 */
export type RuntimeStateErrorCode = "active-owner" | "same-named-class";

/** Ayme is not set up for this call. */
export class RuntimeStateError extends AymeError {
  override readonly name = "RuntimeStateError";
  readonly kind = "runtime";
  readonly code?: RuntimeStateErrorCode;

  constructor(
    message: string,
    options?: ErrorOptions & { code?: RuntimeStateErrorCode }
  ) {
    super(message, options);
    this.code = options?.code;
  }
}

/**
 * A thrown error as text: its full message, prefixed with its name unless
 * that is plain "Error", and followed by the Change Record a failed action
 * left on it.
 */
export function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const text =
    !error.name || error.name === "Error"
      ? error.message
      : `${error.name}: ${error.message}`;
  return text + changeRecordText(error);
}

/** The Change Record a failed action left on its error, as text to follow it. */
const changeRecordText = (error: Error) =>
  (["changes_before", "changes"] as const)
    .map((name) => {
      const part = (error as Partial<Record<typeof name, unknown>>)[name];
      return typeof part === "string" && part ? `\n\n${name}:\n${part}` : "";
    })
    .join("");

/** `text` closed with a full stop, unless it already ends in `.`, `?` or `!`. */
export const asSentence = (text: string): string =>
  /[.?!]$/.test(text) ? text : `${text}.`;
