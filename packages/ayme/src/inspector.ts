/**
 * Loads the optional Inspector package for the `inspector` option. Bundlers
 * keep the import in its own chunk, so a session without the option requests
 * no Inspector code.
 */
export async function loadInspector(): Promise<
  Pick<typeof import("@ayme-dev/inspector"), "mountInspector">
> {
  try {
    // @boundaries-ignore An optional peer dependency, which Turbo doesn't count.
    return await import("@ayme-dev/inspector");
  } catch (error) {
    throw new Error(
      `The inspector option could not load @ayme-dev/inspector. Install it beside @ayme-dev/ayme, or turn the option off. Cause: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
}
