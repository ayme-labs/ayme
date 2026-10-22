import type { ToolManifest } from "../shared";
import { availabilityPredicateOf, modelOption } from "./decorators";
import { errorText } from "../shared";
import type { PredicateAnswer } from "./pomInstance";

/**
 * Package-internal: asks each action's availability predicate about
 * `instance`, read-only. A predicate that throws makes its action
 * unavailable, with the error as the reason, so the author sees it.
 */
export async function askPredicates(
  instance: object,
  tools: readonly ToolManifest[]
): Promise<ReadonlyMap<string, PredicateAnswer>> {
  const answers = new Map<string, PredicateAnswer>();
  for (const tool of tools) {
    const predicate = predicateFor(instance, tool.methodName);
    if (!predicate) continue;
    let verdict: boolean | string;
    try {
      verdict = await predicate(instance as never);
    } catch (error) {
      verdict = errorText(error);
    }
    answers.set(
      tool.methodName,
      typeof verdict === "string" && verdict !== ""
        ? { available: false, reason: verdict }
        : { available: Boolean(verdict) }
    );
  }
  return answers;
}

/** What a Page Object's presence predicate answered, or threw. */
export type PresenceAnswer = { present?: boolean; error?: string };

/**
 * Package-internal: asks the presence predicate `instance`'s class declares
 * or inherits, read-only. Without one, `present` is undefined. A predicate
 * that throws makes the instance absent, with the error's text, so the
 * author sees it.
 */
export async function askPresence(instance: object): Promise<PresenceAnswer> {
  const predicate = modelOption(instance.constructor, "present");
  if (!predicate) return { present: undefined };
  try {
    return { present: Boolean(await predicate(instance as never)) };
  } catch (error) {
    return { present: false, error: errorText(error) };
  }
}

/**
 * The predicate `@ayme.action` kept for the class method `methodName`, read
 * along the prototype chain so inherited actions keep theirs and an
 * instance's own copy of the method, such as one bound in the constructor,
 * does not hide it.
 */
function predicateFor(instance: object, methodName: string) {
  const prototype = Object.getPrototypeOf(instance) as Record<
    string,
    unknown
  > | null;
  return (
    availabilityPredicateOf(prototype?.[methodName]) ??
    availabilityPredicateOf((instance as Record<string, unknown>)[methodName])
  );
}
