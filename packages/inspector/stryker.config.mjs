import { defineStrykerConfig } from "@ayme-dev/test-config/stryker";

// Two workers, in the full lane too. Each Inspector test runner holds its own
// Chromium with the panel loaded, about 1.5 GB, and four of them ran a
// 16 GB CI runner out of memory: the weekly Analysis lost it mid-run. The
// workflow splits the Inspector into more shards to keep each job's run time.
export default { ...defineStrykerConfig(), concurrency: 2 };
