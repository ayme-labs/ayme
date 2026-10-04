import { pageStateNodeEntry } from "@ayme-dev/ayme/internal";

import { structureTreeBuilder } from "../domain/structure";

/**
 * Builds the structure tree, each node's own lines rendered the way the page
 * state renders them for an agent.
 */
export const buildStructureTree = structureTreeBuilder(pageStateNodeEntry);
