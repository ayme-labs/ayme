import {
  agentPort,
  certificationConfig,
} from "@ayme-dev/example-certification/config";

// Read only by `server/plugins/ayme.ts`, where the App Process starts.
const env = { AYME_EXAMPLE_AGENT_PORT: String(agentPort) };

export default await certificationConfig({
  name: "nuxt",
  webServer: ({ port, server }) =>
    server === "dev"
      ? // The dev script fails when the port is taken; `nuxt dev` would move.
        { command: `pnpm run dev --port ${port}`, env }
      : {
          command: "pnpm run start",
          // The App Process stays off in production, whatever the port says.
          env: { ...env, HOST: "127.0.0.1", PORT: String(port) },
        },
});
