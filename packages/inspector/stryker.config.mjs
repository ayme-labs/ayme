import { defineStrykerConfig } from "@ayme-dev/test-config/stryker";

export default {
  ...defineStrykerConfig(),
  // An Inspector test runner's Chromium grows by about 50 MB with each mutant
  // it tests and never gives it back, so a long full-lane run used up a 16 GB
  // CI runner and lost the job. Stryker replaces each test runner, with its
  // Chromium, after 20 mutants; a restart costs about ten seconds.
  maxTestRunnerReuse: 20,
  // Two workers rather than one per core keep a job's peak memory well clear
  // of the runner's limit; the Analysis workflow gives the Inspector twice the
  // shards to keep each job's run time.
  concurrency: 2,
};
