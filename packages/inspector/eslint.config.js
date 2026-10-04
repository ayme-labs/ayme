import config from "@ayme-dev/eslint-config/base";

const runtimeBoundary =
  "Only infrastructure code reads @ayme-dev/ayme; components take props.";

export default [
  ...config,
  {
    files: ["src/**/*.{ts,tsx}"],
    // Infrastructure, and the instrumentation that mounts the Inspector.
    ignores: [
      "src/adapter/**",
      "src/**/infrastructure/**",
      "src/index.ts",
      "src/withDemoFeedback.ts",
      // Until the runtime calls move into infrastructure.
      "src/app/useRuntimeAdapter.ts",
      "src/structure/domain/structure.ts",
      "src/**/*.test.{ts,tsx}",
    ],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: ["@ayme-dev/ayme", "@ayme-dev/ayme/internal"].map((name) => ({
            name,
            allowTypeImports: true,
            message: runtimeBoundary,
          })),
        },
      ],
    },
  },
];
