import { certificationConfig } from "@ayme-dev/example-certification/config";

export default await certificationConfig({
  name: "nuxt",
  webServer: ({ port, server }) =>
    server === "dev"
      ? // The dev script fails when the port is taken; `nuxt dev` would move.
        { command: `pnpm run dev --port ${port}` }
      : {
          command: "pnpm run start",
          env: { HOST: "127.0.0.1", PORT: String(port) },
        },
});
