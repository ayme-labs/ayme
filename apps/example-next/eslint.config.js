import config from "@ayme-dev/eslint-config/base";

export default [
  ...config,
  {
    ignores: [
      ".next/**",
      ".next-dev/**",
      ".next-without-ayme/**",
      "next-env.d.ts",
    ],
  },
];
