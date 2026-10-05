import { test } from "@playwright/test";
import { agentConnectionTests } from "@ayme-dev/example-certification/tests";

// The app turns the Agent Connection on in development only.
agentConnectionTests({
  enabled: () => test.info().config.metadata.server === "development",
  snapshotText: 'button "Increment"',
});
