import type { ConnectionBehaviour } from "../connection";

/** Logs when a page pairs and unpairs, for the developer reading stderr. */
export const logPairing: ConnectionBehaviour = ({ connection, log }) =>
  connection.subscribe((event) => {
    if (event.type === "paired") log("A page connected.");
    if (event.type === "unpaired") log("The page disconnected.");
  });
