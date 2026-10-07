import { certificationConfig } from "@ayme-dev/example-certification/config";

export default await certificationConfig({
  name: "angular",
  webServer: ({ port, server, render }) =>
    server === "dev"
      ? {
          // Without live reload, a test's own reload is the only navigation.
          command: `pnpm exec ng serve --host 127.0.0.1 --port ${port} --no-live-reload${render === "spa" ? " --configuration spa" : ""}`,
        }
      : {
          command: render === "spa" ? "pnpm run start:spa" : "pnpm run start",
          env: { HOST: "127.0.0.1", PORT: String(port) },
        },
});
