import type { ClientBehaviour } from "../connection";
import { answerToolCalls, publishPageTools } from "../tools";

/**
 * What an App Process does while its channel to the server is open. It
 * has no document, so it reports no navigation.
 */
export const processBehaviours: readonly ClientBehaviour[] = [
  publishPageTools,
  answerToolCalls,
];
