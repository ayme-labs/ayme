import type { ClientBehaviour } from "../connection";
import { HIDDEN_BECAUSE } from "../contract";

/**
 * Logs each of the App Process's tools the server hides because an earlier
 * App Process offers the same name, whenever it becomes hidden and once
 * while it stays hidden, for the developer reading the process's terminal.
 */
export const logHiddenTools: ClientBehaviour = ({ channel }) => {
  let logged = new Set<string>();
  return channel.followHiddenTools((hidden) => {
    for (const name of hidden)
      if (!logged.has(name))
        console.warn(
          `[ayme] ${name} is hidden: ${HIDDEN_BECAUSE}. Rename one.`
        );
    logged = new Set(hidden);
  });
};
