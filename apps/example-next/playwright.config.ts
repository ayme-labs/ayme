import {
  agentPort,
  certificationConfig,
} from "@ayme-dev/example-certification/config";

export default await certificationConfig({
  name: "next",
  webServer: ({ port, server }) => ({
    command: `pnpm exec next ${server === "dev" ? "dev" : "start"} --hostname 127.0.0.1 --port ${port}`,
    // Read only by `instrumentation.ts`, where the App Process starts.
    env: { AYME_EXAMPLE_AGENT_PORT: String(agentPort) },
  }),
});
