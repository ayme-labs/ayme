import config from "@ayme-dev/eslint-config/base";

export default [
  ...config,
  { ignores: [".svelte-kit/**", "build/**", "build-spa/**"] },
];
