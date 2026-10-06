import { agentConnectionTests } from "@ayme-dev/example-certification/tests";

// The playground turns the Agent Connection on unless built with
// `--mode inspector-disabled`; the tests run the dev server.
agentConnectionTests({
  enabled: () => true,
  snapshotText: 'button "Add item"',
  peek: true,
});
