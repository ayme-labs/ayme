import type { PageWelcome } from "../../contract";

/**
 * The welcome a page or App Process gets when it says hello: the token it
 * reconnects with, the folder a tool's images are saved to, and the name
 * of the agent's MCP client, each when there is one.
 */
export function pageWelcome({
  token,
  imageFolder,
  agent,
}: {
  token: string | undefined;
  imageFolder: string | undefined;
  agent: string | undefined;
}): PageWelcome {
  return {
    ...(token === undefined ? {} : { token }),
    ...(imageFolder === undefined ? {} : { imageFolder }),
    ...(agent ? { agent } : {}),
  };
}
