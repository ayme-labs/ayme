import { agentConnectionTests } from "@ayme-dev/example-certification/tests";

// The app turns the Agent Connection on unless built with
// `--mode inspector-disabled`; the tests run the dev server.
agentConnectionTests({
  enabled: () => true,
  snapshotText: 'button "Increment"',
  peek: true,
});
