import {
  certificationConfig,
  type ExampleServerCommand,
} from "@ayme-dev/example-certification/config";

export default await certificationConfig({
  name: "sveltekit",
  webServer: ({ port, server, render }): ExampleServerCommand => {
    if (server === "dev")
      return {
        command: `pnpm exec vite dev --host 127.0.0.1 --port ${port} --strictPort`,
        // Read by the root `+layout.ts`.
        env: { VITE_AYME_SSR: render === "spa" ? "off" : "on" },
      };
    return {
      command: render === "spa" ? "pnpm run start:spa" : "pnpm run start",
      env: { HOST: "127.0.0.1", PORT: String(port) },
    };
  },
});
