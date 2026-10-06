import type { ClientBehaviour } from "../connection";

const HIDDEN_BECAUSE = {
  page: "the page offers a tool with the same name",
  process: "another App Process offers a tool with the same name",
} as const;

/**
 * Logs each of the App Process's tools the server hides because another
 * connection offers the same name, whenever it becomes hidden and once
 * while it stays hidden, for the developer reading the process's terminal.
 */
export const logHiddenTools: ClientBehaviour = ({ channel }) => {
  let logged = new Set<string>();
  return channel.followHiddenTools((hidden) => {
    for (const { name, offeredBy } of hidden)
      if (!logged.has(name))
        console.warn(
          `[ayme] ${name} is hidden: ${HIDDEN_BECAUSE[offeredBy]}. Rename one.`
        );
    logged = new Set(hidden.map(({ name }) => name));
  });
};
