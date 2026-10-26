import type { PomMemberObservation } from "../../shared";
import { sameInstance, type PomInstanceObservation } from "./pomInstance";
import type { PageObjectObservation } from "./pomTree";

/** What the last observation of a registered Page Object found. */
export type LastObservation = {
  /** Every instance it found; undefined before the first observation. */
  instances: readonly PomInstanceObservation[] | undefined;
  memberObservations: readonly PomMemberObservation[];
};

/**
 * Package-internal: whether `observation` found the same facts as `last`, so
 * a probe that found nothing new notifies nobody.
 */
export function sameObservation(
  last: LastObservation,
  { instances, memberObservations }: PageObjectObservation
): boolean {
  const previous = last.instances;
  return (
    previous?.length === instances.length &&
    previous.every((instance, index) =>
      sameInstance(instance, instances[index]!)
    ) &&
    sameMemberObservations(last.memberObservations, memberObservations)
  );
}

function sameMemberObservations(
  left: readonly PomMemberObservation[],
  right: readonly PomMemberObservation[]
) {
  return (
    left.length === right.length &&
    left.every((observation, index) => {
      const candidate = right[index];
      return (
        candidate !== undefined &&
        observation.memberName === candidate.memberName &&
        observation.kind === candidate.kind &&
        observation.count === candidate.count &&
        observation.access === candidate.access &&
        observation.error === candidate.error
      );
    })
  );
}

/**
 * Package-internal: what `observation` of the registered Page Object `pomId`
 * found wrong that `last` did not, one message each: a presence or root
 * predicate that threw, an invalid member or root, or a root matching several
 * elements. A problem is reported again only when
 * it changed, or was gone and is back. A root matching none is ordinary
 * absence, never reported.
 */
export function newObservationErrors(
  pomId: string,
  last: LastObservation,
  { instances, memberObservations }: PageObjectObservation
): string[] {
  const errors: string[] = [];
  const previous = new Map(
    last.instances?.map((instance) => [instance.path, instance])
  );
  for (const instance of instances) {
    const before = previous.get(instance.path);
    const path = instance.path ? `${pomId}.${instance.path}` : pomId;
    const label = `${instance.className} at ${path}`;
    if (
      instance.presenceError !== undefined &&
      instance.presenceError !== before?.presenceError
    )
      errors.push(
        `${label}: its present predicate threw ${instance.presenceError}.`
      );
    if (
      instance.rootCount !== undefined &&
      instance.rootCount >= 2 &&
      instance.rootCount !== before?.rootCount
    )
      errors.push(`${label}: its root matches ${instance.rootCount} elements.`);
  }
  const previousErrors = new Set(
    last.memberObservations.map(({ error }) => error)
  );
  for (const { error } of memberObservations)
    if (error !== undefined && !previousErrors.has(error)) errors.push(error);
  return errors;
}
