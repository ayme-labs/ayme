import type { PageWelcome } from "../../contract";

/**
 * The welcome a page or App Process gets when it says hello: the token it
 * reconnects with and the name of the agent's MCP client, each when there
 * is one.
 */
export function pageWelcome({
  token,
  agent,
}: {
  token: string | undefined;
  agent: string | undefined;
}): PageWelcome {
  return {
    ...(token === undefined ? {} : { token }),
    ...(agent ? { agent } : {}),
  };
}
