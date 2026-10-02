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

/** Ayme is not set up for this call. */
export class RuntimeStateError extends AymeError {
  override readonly name = "RuntimeStateError";
  readonly kind = "runtime";
}
