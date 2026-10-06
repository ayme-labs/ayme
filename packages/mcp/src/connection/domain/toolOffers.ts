import type { PageTool } from "../../contract";

/** The tools one connection offers: the page or an App Process. */
export type ToolOffer<Owner> = {
  owner: Owner;
  tools: readonly PageTool[];
};

/** A tool the agent sees, and the connection a call to it goes to. */
export type ShownTool<Owner> = { tool: PageTool; owner: Owner };

/** A tool the agent does not see, and the connection that keeps its name. */
export type HiddenOffer<Owner> = { name: string; owner: Owner; keptBy: Owner };

/**
 * The tools the agent sees from `offers`, in order, and those it does not.
 * Each name goes to the first offer that has it, so the agent sees one tool
 * per name and each call reaches one connection; a later offer of the same
 * name is hidden. Offers are not merged.
 */
export function mergeToolOffers<Owner>(offers: readonly ToolOffer<Owner>[]): {
  shown: ShownTool<Owner>[];
  hidden: HiddenOffer<Owner>[];
} {
  const shown: ShownTool<Owner>[] = [];
  const hidden: HiddenOffer<Owner>[] = [];
  const keptBy = new Map<string, Owner>();
  for (const { owner, tools } of offers)
    for (const tool of tools) {
      const keeper = keptBy.get(tool.name);
      if (keeper === undefined) {
        keptBy.set(tool.name, owner);
        shown.push({ tool, owner });
      } else hidden.push({ name: tool.name, owner, keptBy: keeper });
    }
  return { shown, hidden };
}
