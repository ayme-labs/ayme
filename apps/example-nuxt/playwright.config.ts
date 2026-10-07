import { certificationConfig } from "@ayme-dev/example-certification/config";

export default await certificationConfig({
  name: "nuxt",
  webServer: ({ port, server }) =>
    server === "dev"
      ? { command: `pnpm exec nuxt dev --host 127.0.0.1 --port ${port}` }
      : {
          command: "pnpm run start",
          env: { HOST: "127.0.0.1", PORT: String(port) },
        },
});
