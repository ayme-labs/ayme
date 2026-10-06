import { test } from "@playwright/test";
import { agentConnectionTests } from "@ayme-dev/example-certification/tests";

// The app turns the Agent Connection on in development only, in the page
// and in the App Process `server/plugins/ayme.ts` starts.
agentConnectionTests({
  enabled: () => test.info().config.metadata.server === "development",
  snapshotText: 'button "Increment"',
  peek: true,
  appProcess: { peek: "renders" },
});
