import type { ClientBehaviour } from "../connection";
import { answerToolCalls, publishPageTools } from "../tools";

/** What the page client does while its channel to the server is open. */
export const clientBehaviours: readonly ClientBehaviour[] = [
  publishPageTools,
  answerToolCalls,
];
