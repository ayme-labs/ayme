import { inPage } from "../../in-page";
import type { Reach } from "../application/reach";

/**
 * Package-internal: the Reach adapter of the browser runtime. It measures
 * in the document, in the in-page module (ADR-0049), the same measurement a
 * Node host reads through `inPage(page)` (ADR-0041). The runtime picks it
 * unless a unit test hands its session another.
 */
export const geometryReach: Reach = {
  reachable: (page, refs, input) => inPage(page).reachable(refs, input),
  measureReachAtCall: (page, ref) =>
    inPage(page).measureReach(ref, { atCall: true }),
  blockingAncestor: (page, ref) => inPage(page).blockingAncestor(ref),
};
