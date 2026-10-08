import type { ConnectionBehaviour } from "../connection";

/**
 * Logs when a page or App Process pairs and unpairs, for the developer
 * reading stderr.
 */
export const logPairing: ConnectionBehaviour = ({ connection, log }) =>
  connection.subscribe((event) => {
    if (event.type === "paired") log("A page connected.");
    if (event.type === "unpaired") log("The page disconnected.");
    if (event.type === "processPaired") log("An App Process connected.");
    if (event.type === "processUnpaired") log("An App Process disconnected.");
  });
