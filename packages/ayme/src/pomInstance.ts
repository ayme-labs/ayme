import type { AriaRef } from "@ayme-dev/core/structural-observation";
import type { Locator } from "@playwright/test";
import type { ToolManifest } from "./contracts";
import { availabilityPredicateOf, modelOption } from "./decorators";
import { asSentence, errorText, RuntimeStateError } from "./errors";
import type { ObservedPomRoot } from "./pomRootObservation";

/**
 * Package-internal: whether a tool, or an action on one Page Object
 * instance, can be offered and run now (ADR-0035): `present` while its Page
 * Object is, so it is listed; `available` while a call would run it;
 * otherwise `reason`, the Availability Reason, when there is one.
 */
export type ToolAvailability = {
  present: boolean;
  available: boolean;
  reason?: string;
};

/**
 * Package-internal: the Structural Ref the agent's latest page state gave
 * `element`, if any; how an Availability Reason names what is in the way.
 */
export type LatestRefLookup = (element: Element) => AriaRef | undefined;

/** What an action's availability predicate answered. */
export type PredicateAnswer = { available: boolean; reason?: string };

/**
 * Package-internal: one live Page Object instance as the last observation
 * found it: the page's own, or a component instance. It holds the facts its
 * Action Availability is decided from and nothing joins them later.
 */
export type PomInstanceObservation = {
  /** Its path from the page, e.g. "items[1].details"; "" for the page's own. */
  path: string;
  /** The live Page Object the observation read: what a call on it acts on. */
  instance: object;
  /**
   * Its tools' component path, which has no item indices, e.g.
   * "items[].details"; undefined for the page's own. An instance whose
   * class appears higher on its path through a collection, with a root of
   * its own, has its first occurrence's, e.g. "items[]" for
   * "items[0].children[1]".
   */
  componentPath: string | undefined;
  /**
   * The innermost collection item it is or lies in, e.g. the instance at
   * "items[1]" for "items[1].details", or itself when it joined its first
   * occurrence's instances; undefined outside collections.
   */
  item: PomInstanceObservation | undefined;
  /**
   * Whether it is on the page (Page Object Presence): its presence
   * predicate, when its class declares one, holds, and its root, when it has
   * one, is present.
   */
  present: boolean;
  /** What its presence predicate threw, when it threw. */
  presenceError?: string;
  /**
   * Its root, or undefined for a Page Object without a declared root, or one
   * whose presence predicate failed before the root was read.
   */
  root: ObservedPomRoot | undefined;
  /**
   * The locator its root predicate answered with the observation: what a
   * call measures reach at, so no call runs the predicate again. Undefined
   * without a root, or when the predicate threw or answered no locator.
   */
  rootLocator?: Locator;
  /** What its root predicate threw, when it threw. */
  rootError?: string;
  /** How many elements its root locator matched; 0 when it answered none. */
  rootCount?: number;
  /**
   * What each action's availability predicate answered, by method name.
   * Asked only while the instance is present; actions without one are absent.
   */
  predicates: ReadonlyMap<string, PredicateAnswer>;
};

/**
 * Package-internal: whether the action `methodName` can run on `instance`
 * now, by ADR-0035's precedence: an absent Page Object, then a root a click
 * would not reach, then the action's predicate. It reads only the
 * observation and, to name what is in the way, `latestRefOf`.
 */
export function availabilityOf(
  instance: PomInstanceObservation,
  methodName: string,
  latestRefOf: LatestRefLookup
): ToolAvailability {
  const { root } = instance;
  if (!instance.present) return { present: false, available: false };
  if (root !== undefined && !root.available)
    return {
      present: true,
      available: false,
      reason: obstructionReason(root.inTheWay, latestRefOf),
    };
  const answer = instance.predicates.get(methodName);
  if (!answer || answer.available) return { present: true, available: true };
  return { present: true, available: false, reason: answer.reason };
}

/**
 * Package-internal: refuses a call of the tool `toolName` that `availability`
 * says would not run, the tool's own or the one on the instance the call
 * names: `<tool> is unavailable: <reason>.`, or without the reason when there
 * is none.
 */
export function assertAvailable(
  toolName: string,
  availability: ToolAvailability
) {
  if (availability.available) return;
  throw unavailableError(toolName, availability);
}

/**
 * Package-internal: the error `assertAvailable` refuses a call with, for a
 * caller that has found the call cannot run.
 */
export function unavailableError(
  toolName: string,
  { present, reason }: Pick<ToolAvailability, "present" | "reason">
) {
  const why = present ? reason : "its Page Object is not on the page";
  return new RuntimeStateError(
    why === undefined
      ? `${toolName} is unavailable.`
      : asSentence(`${toolName} is unavailable: ${why}`)
  );
}

/**
 * Package-internal: one tool's availability over the instances it stands
 * for: available while any is; when none is, the first present instance's
 * reason.
 */
export function combinedAvailability(
  states: readonly ToolAvailability[]
): ToolAvailability {
  const available = states.some((state) => state.available);
  const [first] = states.filter((state) => state.present);
  if (available || first === undefined)
    return { present: first !== undefined, available };
  return { present: true, available: false, reason: first.reason };
}

/**
 * Package-internal: the runtime's Availability Reason for a present element a
 * click would not reach: it names the Structural Ref of the first element in
 * the way the agent's latest page state gave one.
 */
export function obstructionReason(
  inTheWay: readonly Element[],
  latestRefOf: LatestRefLookup
) {
  const ref = inTheWay.map(latestRefOf).find((ref) => ref !== undefined);
  return ref === undefined
    ? "a click would not reach it"
    : `a click would not reach it; ${ref} is in the way`;
}

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

/**
 * Package-internal: whether two observations of the same instance found the
 * same facts, so a probe that found nothing new notifies nobody.
 */
export function sameInstance(
  left: PomInstanceObservation,
  right: PomInstanceObservation
): boolean {
  return (
    left.path === right.path &&
    left.present === right.present &&
    left.presenceError === right.presenceError &&
    left.rootError === right.rootError &&
    sameRoot(left.root, right.root) &&
    left.predicates.size === right.predicates.size &&
    [...left.predicates].every(([methodName, answer]) => {
      const other = right.predicates.get(methodName);
      return (
        other !== undefined &&
        other.available === answer.available &&
        other.reason === answer.reason
      );
    })
  );
}

function sameRoot(
  left: ObservedPomRoot | undefined,
  right: ObservedPomRoot | undefined
) {
  if (left === undefined || right === undefined) return left === right;
  return (
    left.element === right.element &&
    left.present === right.present &&
    left.available === right.available &&
    left.inTheWay.length === right.inTheWay.length &&
    left.inTheWay.every((element, index) => element === right.inTheWay[index])
  );
}
