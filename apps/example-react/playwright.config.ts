import { certificationConfig } from "@ayme-dev/example-certification/config";

export default await certificationConfig({
  name: "react",
  webServer: ({ port, server }) => ({
    // The production build is the `dist` that `pnpm run build` wrote.
    command: `pnpm exec vite${server === "dev" ? "" : " preview"} --host 127.0.0.1 --port ${port} --strictPort`,
  }),
});
