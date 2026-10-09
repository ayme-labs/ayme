import { defineStrykerConfig } from "@ayme-dev/test-config/stryker";

const config = defineStrykerConfig();

export default {
  ...config,
  mutate: [
    ...config.mutate,
    // Its hit-test runs in the page through evaluateAll, which serializes the
    // function, so Stryker's instrumented copy can't run there and its tests
    // fail in every sandbox.
    "!src/panel/infrastructure/panelPassThrough.ts",
  ],
};
