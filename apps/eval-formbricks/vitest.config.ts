import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // The lane tests start Node processes (the stand-in for Claude Code, a
    // stub MCP server) and give each run 10 s. On a loaded CI runner, a test
    // that starts several of them can pass vitest's 5 s default before its
    // runs' own timeouts are reached.
    testTimeout: 30_000,
  },
});
