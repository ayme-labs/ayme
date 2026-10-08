/**
 * Test support for the look tests: a runtime session, and the agent's calls
 * through the tools WebMCP publishes.
 */
import { createPage } from "./browserPage";
import { agentTools } from "./publication.testSupport";
import { createAyme } from "./runtime";

export async function startAgentSession(
  setup: (runtime: ReturnType<typeof createAyme>) => void = () => {}
) {
  const runtime = createAyme({ pageFactory: () => createPage() });
  setup(runtime);
  const stop = runtime.start();
  const tools = agentTools();
  /** A call as the calling agent makes it. */
  const call = (name: string, input: unknown) =>
    tools.call(name, input) as Promise<Record<string, unknown>>;
  /** The structure an agent reads through snapshot. */
  const read = async () =>
    ((await call("snapshot", {})) as { structure: string }).structure;
  return { call, read, stop };
}

/** The `e` refs a rendered structure gives each role and name, in order. */
export function refsIn(structure: string) {
  return [...structure.matchAll(/(?:^|\s)(e\d+) (\w+)(?: "([^"]*)")?/gm)].map(
    ([, ref, role, name]) => `${ref} ${role} ${name ?? ""}`.trim()
  );
}
