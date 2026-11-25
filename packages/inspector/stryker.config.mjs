import { defineStrykerConfig } from "@ayme-dev/test-config/stryker";

const shared = defineStrykerConfig();

export default {
  ...shared,
  // Skips the strings holding Tailwind classes, which are styling no test
  // reads; see stryker/classStrings.mjs.
  plugins: [...shared.plugins, "./stryker/classStrings.mjs"],
  ignorers: ["classStrings"],
  // An Inspector test runner's Chromium grows by about 50 MB with each mutant
  // it tests and never gives it back, so a long full-lane run used up a 16 GB
  // CI runner and lost the job. Stryker replaces each test runner, with its
  // Chromium, after 10 mutants; a restart costs about ten seconds. At 20,
  // mutants of components most tests render, such as the panel's Header, left
  // a shard 1.5 GB from running out.
  maxTestRunnerReuse: 10,
  // Two workers rather than one per core keep a job's peak memory well clear
  // of the runner's limit.
  concurrency: 2,
};
