import type { Locator } from "@playwright/test";
import {
  obstructionReason,
  type LatestRefLookup,
  type ToolAvailability,
} from "../../page-state";

/** What an action's availability predicate answered. */
export type PredicateAnswer = { available: boolean; reason?: string };

/**
 * Package-internal: what one observation of a Page Object Root found
 * (ADR-0035): whether it is on the page, whether a click would reach it,
 * and, for a present root a click would not reach, what is in the way. The
 * runtime reports the measurement, never a kind of widget.
 */
export type ObservedPomRoot = {
  /** Its element, while the locator resolved to that one element throughout. */
  element: Element | undefined;
  present: boolean;
  available: boolean;
  /**
   * What an Availability Reason may name as in the way of a present root a
   * click would not reach (see `inTheWayOf`); empty for every other root.
   */
  inTheWay: readonly Element[];
};

/** Package-internal: a Page Object Root that is not on the page. */
export const absentPomRoot: ObservedPomRoot = {
  element: undefined,
  present: false,
  available: false,
  inTheWay: [],
};

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
  /** The class whose tools act on this instance. */
  className: string;
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
  /** How many elements its root locator matched; 0 when it answered none. */
  rootCount?: number;
  /**
   * What each action's availability predicate answered, by method name.
   * Asked only while the instance is present and a click would reach its
   * root, if it has one; actions without one are absent.
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
