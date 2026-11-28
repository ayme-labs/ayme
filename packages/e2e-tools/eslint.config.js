import config from "@ayme-dev/eslint-config/base";

export default [
  ...config,
  {
    // The launcher and its module hook are plain JavaScript, so Node loads
    // them before any TypeScript loader exists; lint knows no Node globals.
    files: ["patched-e2e/**/*.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
        TextDecoder: "readonly",
        URL: "readonly",
      },
    },
  },
];
