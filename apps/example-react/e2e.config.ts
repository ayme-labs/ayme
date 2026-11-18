import { certificationConfig } from "@ayme-dev/example-certification/e2e/config";

export default certificationConfig({
  command: ({ server }) => ({
    // The production build is the `dist` that `pnpm run build` wrote.
    executable: "pnpm",
    args: [
      "exec",
      "vite",
      ...(server === "dev" ? [] : ["preview"]),
      "--host",
      "127.0.0.1",
      "--port",
      "{port}",
      "--strictPort",
    ],
  }),
});
