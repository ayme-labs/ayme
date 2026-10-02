import type { Run } from "../adapter/useRuns";
import { runIsOnMember } from "../frame/memberSelection";
import type { Selection } from "../frame/selection";

/** Which runs belong to the selection, and what Runs calls that scope. */
export type RunScope = {
  label: "This page" | "This object" | "This tool";
  includes: (run: Run) => boolean;
};

/**
 * The runs of the selection: on the page, every run; on a Page Object, the
 * runs on it or on the objects inside it; on a Page Object Model, the runs of
 * its actions; on a member, the runs on it or whose steps acted on it; on a
 * structure node, the runs on its ref or on the object it
 * maps to; on a tool, that tool's runs.
 *
 * @param membersOf the Page Object members a structure node is, by ref.
 */
export function runScope(
  selection: Selection,
  membersOf: (ref: string) => readonly string[]
): RunScope {
  switch (selection.kind) {
    case "page":
      return { label: "This page", includes: () => true };
    case "object":
      return {
        label: "This object",
        includes: (run) => within(run.objectPath, selection.path),
      };
    case "model":
      return {
        label: "This object",
        includes: (run) => run.className === selection.className,
      };
    case "member":
      return {
        label: "This object",
        includes: (run) =>
          runIsOnMember(selection.path, {
            objectPath: run.objectPath,
            stepMembers: run.steps.map((step) => step.member),
          }),
      };
    case "node": {
      const members = membersOf(selection.ref);
      return {
        label: "This object",
        includes: (run) =>
          run.item?.ref === selection.ref ||
          run.arguments.ref === selection.ref ||
          members.some((member) => within(run.objectPath, member)),
      };
    }
    case "tool":
      return {
        label: "This tool",
        includes: (run) => run.toolName === selection.name,
      };
  }
}

/** Whether a path is the object at `path` or inside it. */
function within(objectPath: string | undefined, path: string) {
  if (objectPath === undefined) return false;
  return (
    objectPath === path ||
    objectPath.startsWith(`${path}.`) ||
    objectPath.startsWith(`${path}[`)
  );
}
