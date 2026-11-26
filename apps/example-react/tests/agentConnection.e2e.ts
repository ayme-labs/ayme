import { agentConnectionTests } from "@ayme-dev/example-certification/e2e/tests";

// The app turns the Agent Connection on unless built with
// `--mode inspector-disabled`; the tests run the dev server.
agentConnectionTests({
  enabled: () => true,
  pageObject: "CounterPage",
  peek: true,
});
