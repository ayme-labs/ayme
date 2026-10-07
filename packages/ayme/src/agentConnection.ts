/**
 * Loads the optional page client for the `agentConnection` option. Bundlers
 * keep the import in its own chunk, so a session without the option requests
 * no Agent Connection code.
 */
export async function loadAgentConnection(): Promise<
  Pick<typeof import("@ayme-dev/mcp/client"), "startAgentConnection">
> {
  try {
    // @boundaries-ignore An optional peer dependency, which Turbo doesn't count.
    return await import("@ayme-dev/mcp/client");
  } catch (error) {
    throw new Error(
      `The agentConnection option could not load @ayme-dev/mcp. Install it beside @ayme-dev/ayme, or turn the option off. Cause: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
}

/**
 * Loads an App Process's side of the Agent Connection for the
 * `agentConnection` option in Node. Like the page client, it is imported
 * only when the option is on.
 */
export async function loadProcessConnection(): Promise<
  Pick<typeof import("@ayme-dev/mcp/process"), "startAgentConnection">
> {
  try {
    // @boundaries-ignore An optional peer dependency, which Turbo doesn't count.
    return await import("@ayme-dev/mcp/process");
  } catch (error) {
    throw new Error(
      `The agentConnection option could not load @ayme-dev/mcp. Install it beside @ayme-dev/ayme, or turn the option off. Cause: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
}
