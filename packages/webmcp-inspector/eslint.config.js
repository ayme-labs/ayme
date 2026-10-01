import config from "@ayme-dev/eslint-config/base";

const runtimeBoundary =
  "Only the runtime adapter (src/adapter) reads webmcp; components take props.";

export default [
  ...config,
  {
    files: ["src/**/*.{ts,tsx}"],
    // The adapter, and the instrumentation that mounts the Inspector.
    ignores: [
      "src/adapter/**",
      "src/index.ts",
      "src/withDemoFeedback.ts",
      "src/**/*.test.{ts,tsx}",
    ],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: ["@ayme-dev/webmcp", "@ayme-dev/webmcp/internal"].map(
            (name) => ({
              name,
              allowTypeImports: true,
              message: runtimeBoundary,
            })
          ),
        },
      ],
    },
  },
];
