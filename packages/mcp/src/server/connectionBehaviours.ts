import type { ConnectionBehaviour } from "../connection";
import { logPairing } from "./logPairing";

/** What the server does with its Agent Connection while it runs. */
export const connectionBehaviours: readonly ConnectionBehaviour[] = [
  logPairing,
];
