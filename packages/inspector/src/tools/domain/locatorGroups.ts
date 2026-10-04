/**
 * `generate_locator`'s input: targets grouped by the container their
 * locators are relative to. A group without a container is the page.
 */
export type LocatorGroup = { targets: string[]; within?: string };

/** What a run gave one target: its locator, or why it has none. */
export type LocatorOutcome = { locator: string } | { error: string };

/** What a run gave one group: why its container failed, or each target's outcome. */
export type GroupOutcome =
  { error: string } | { targets: ReadonlyMap<string, LocatorOutcome> };

/** The groups a new form starts with: one, for the page. */
export const initialGroups: readonly LocatorGroup[] = [{ targets: [] }];

/** Adds a target to a group, or removes it when the group has it. */
export function toggleTarget(
  groups: readonly LocatorGroup[],
  index: number,
  ref: string
): LocatorGroup[] {
  return groups.map((group, at) =>
    at !== index
      ? group
      : {
          ...group,
          targets: group.targets.includes(ref)
            ? group.targets.filter((target) => target !== ref)
            : [...group.targets, ref],
        }
  );
}

/** Adds a target to a group, unless the group has it. */
export function addTarget(
  groups: readonly LocatorGroup[],
  index: number,
  ref: string
): LocatorGroup[] {
  return groups[index]?.targets.includes(ref)
    ? [...groups]
    : toggleTarget(groups, index, ref);
}

/** Sets a group's container; none makes it the page's. */
export function setContainer(
  groups: readonly LocatorGroup[],
  index: number,
  within: string | undefined
): LocatorGroup[] {
  return groups.map((group, at) =>
    at !== index
      ? group
      : within
        ? { targets: group.targets, within }
        : { targets: group.targets }
  );
}

/**
 * What a run gave each of `groups`, by index. A run's result lists its
 * groups in the order of its input, so a group gets the outcome of the run's
 * group at its index only while it has the container that one ran with; a
 * target gets the outcome of the same ref there. Nothing for a run that
 * failed or returned something else.
 */
export function groupOutcomes(
  groups: readonly LocatorGroup[],
  run: { arguments: unknown; result?: string } | undefined
): (GroupOutcome | undefined)[] {
  const ran = parse(run);
  return groups.map((group, index) => {
    const input = ran?.input[index];
    const output = ran?.output[index];
    if (!input || !output || input.within !== group.within) return undefined;
    if ("error" in output) return { error: output.error };
    return {
      targets: new Map(
        output.locators.map(({ target, ...outcome }) => [
          target,
          outcome as LocatorOutcome,
        ])
      ),
    };
  });
}

type ResultGroup =
  | { within?: string; error: string }
  | {
      within?: string;
      locators: ({ target: string } & LocatorOutcome)[];
    };

function parse(run: { arguments: unknown; result?: string } | undefined) {
  if (!run?.result) return undefined;
  try {
    const output = (JSON.parse(run.result) as { groups?: ResultGroup[] })
      .groups;
    const input = (run.arguments as { groups?: LocatorGroup[] }).groups;
    return Array.isArray(output) && Array.isArray(input)
      ? { input, output }
      : undefined;
  } catch {
    return undefined;
  }
}
