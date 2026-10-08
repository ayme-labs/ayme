/**
 * Loads the optional WebMCP publication for the `webMCP` option. Bundlers
 * keep the import in its own chunk, so a session without the option requests
 * no WebMCP code.
 */
export async function loadWebMcpPublication(): Promise<
  Pick<typeof import("@ayme-dev/webmcp"), "startWebMcpPublication">
> {
  try {
    // @boundaries-ignore An optional peer dependency, which Turbo doesn't count.
    return await import("@ayme-dev/webmcp");
  } catch (error) {
    throw new Error(
      `The webMCP option could not load @ayme-dev/webmcp. Install it beside @ayme-dev/ayme, or turn the option off. Cause: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
}
