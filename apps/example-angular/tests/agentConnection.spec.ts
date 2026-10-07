import { server } from "@ayme-dev/example-certification/config";
import { agentConnectionTests } from "@ayme-dev/example-certification/tests";

// The app turns the Agent Connection on in development only.
agentConnectionTests({
  enabled: () => server === "dev",
  snapshotText: 'button "Increment"',
});
