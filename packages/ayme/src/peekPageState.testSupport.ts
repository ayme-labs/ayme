/**
 * Test support for the peek tests: a runtime session publishing to a
 * recording driver, and the agent's calls through the published tools.
 */
import { createPage } from "./browserPage";
import { createAyme } from "./runtime";
import { synchronizeWebMcpTools } from "./webMcp";

type Tool = { name: string; execute(input: unknown): Promise<unknown> };

export async function startAgentSession(
  setup: (runtime: ReturnType<typeof createAyme>) => void = () => {}
) {
  const runtime = createAyme({ pageFactory: () => createPage() });
  setup(runtime);
  const stop = runtime.start();
  const tools = new Map<string, Tool>();
  const publication = await synchronizeWebMcpTools({
    async registerTool(tool: Tool) {
      tools.set(tool.name, tool);
    },
  });
  /** A call as the calling agent makes it. */
  const call = (name: string, input: unknown) =>
    tools.get(name)!.execute(input) as Promise<Record<string, unknown>>;
  /** The structure an agent reads through snapshot. */
  const read = async () =>
    ((await call("snapshot", {})) as { structure: string }).structure;
  return {
    call,
    read,
    stop() {
      publication.dispose();
      stop();
    },
  };
}

/** The `e` refs a rendered structure gives each role and name, in order. */
export function refsIn(structure: string) {
  return [...structure.matchAll(/(?:^|\s)(e\d+) (\w+)(?: "([^"]*)")?/gm)].map(
    ([, ref, role, name]) => `${ref} ${role} ${name ?? ""}`.trim()
  );
}
