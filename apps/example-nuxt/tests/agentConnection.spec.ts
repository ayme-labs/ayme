import { server } from "@ayme-dev/example-certification/config";
import { agentConnectionTests } from "@ayme-dev/example-certification/tests";

// The app turns the Agent Connection on in development only, in the page
// and in the App Process `server/plugins/ayme.ts` starts.
agentConnectionTests({
  enabled: () => server === "dev",
  snapshotText: 'button "Increment"',
  peek: true,
  appProcess: { peek: "renders" },
});
