import type { ChildRun, Run } from "./run";
import { runIsOnMember } from "../../structure";
import type { Selection } from "../../navigation";

/** Which runs belong to the selection, and what Runs calls that scope. */
export type RunScope = {
  label: "This page" | "This object" | "This tool";
  /** Whether a top-level Run, or any Run nested under it, belongs to it. */
  includes: (run: Run) => boolean;
};

/** Whether one Run belongs to the selection, given its tree's document. */
type Includes = (run: ChildRun, earlierDocument: boolean) => boolean;

/**
 * The runs of the selection: on the page, every run; on a Page Object, the
 * runs on it or on the objects inside it; on a Page Object Model, the runs of
 * its actions; on a member, the runs on it or whose Interactions acted on it; on a
 * structure node, the runs on its ref or on the object it
 * maps to; on a tool, that tool's runs. A ref names an element of one
 * document only, so a run from an earlier document is never on a node by
 * its refs. A tree of Runs belongs to the selection when its top-level
 * Run or any Run nested under it does.
 *
 * @param membersOf the Page Object members a structure node is, by ref.
 * @param within the paths of the object or member at a path and of
 *   everything inside it.
 */
export function runScope(
  selection: Selection,
  membersOf: (ref: string) => readonly string[],
  within: (path: string) => ReadonlySet<string>
): RunScope {
  const { label, includes } = runScopeOf(selection, membersOf, within);
  const inTree = (run: ChildRun, earlierDocument: boolean): boolean =>
    includes(run, earlierDocument) ||
    run.children.some((child) => inTree(child, earlierDocument));
  return {
    label,
    includes: (run) => inTree(run, run.earlierDocument === true),
  };
}

/** The selection's scope, for one Run on its own. */
function runScopeOf(
  selection: Selection,
  membersOf: (ref: string) => readonly string[],
  within: (path: string) => ReadonlySet<string>
): { label: RunScope["label"]; includes: Includes } {
  /** Whether a run's object is one of `paths`. */
  const isOn = (paths: ReadonlySet<string>, objectPath: string | undefined) =>
    objectPath !== undefined && paths.has(objectPath);
  switch (selection.kind) {
    case "page":
      return { label: "This page", includes: () => true };
    case "object": {
      const paths = within(selection.path);
      return {
        label: "This object",
        includes: (run) => isOn(paths, run.objectPath),
      };
    }
    case "model":
      return {
        label: "This object",
        includes: (run) => run.className === selection.className,
      };
    case "member": {
      const paths = within(selection.path);
      return {
        label: "This object",
        includes: (run) =>
          runIsOnMember(paths, {
            objectPath: run.objectPath,
            interactionMembers: run.interactions.map(({ member }) => member),
          }),
      };
    }
    case "node": {
      const paths = membersOf(selection.ref).map(within);
      return {
        label: "This object",
        includes: (run, earlierDocument) =>
          (!earlierDocument &&
            (run.item?.ref === selection.ref ||
              // A Custom Tool's `ref`, or a Browser Tool's `target`.
              run.arguments.ref === selection.ref ||
              run.arguments.target === selection.ref)) ||
          paths.some((memberPaths) => isOn(memberPaths, run.objectPath)),
      };
    }
    case "tool":
      return {
        label: "This tool",
        includes: (run) => run.toolName === selection.name,
      };
  }
}
