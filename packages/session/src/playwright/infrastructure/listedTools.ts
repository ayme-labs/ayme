import type { ListedTool } from "../../session/domain";

/** A tool as the Node Host of the project's `@ayme-dev/ayme` lists it. */
export type NodeHostTool = {
  readonly name: string;
  /** Where it comes from: `pageObject` for a Page Object Tool. */
  readonly group: string;
  readonly authorDescription?: string;
  /** What an agent reads of it, which a listing shows. */
  readonly agentDescription?: string;
  readonly inputSchema: unknown;
  readonly available: boolean;
  readonly reason?: string;
};

/** The Page Object Tools among the Node Host's tools, as a listing shows
 * them. A Session offers no other tools. */
export const listedTools = (tools: readonly NodeHostTool[]): ListedTool[] =>
  tools
    .filter(({ group }) => group === "pageObject")
    .map(({ name, agentDescription, inputSchema, available, reason }) => ({
      name,
      ...(agentDescription === undefined
        ? {}
        : { description: agentDescription }),
      parameters: inputSchema,
      available,
      ...(reason === undefined ? {} : { reason }),
    }));
