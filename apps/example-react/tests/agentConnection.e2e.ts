import { agentConnectionTests } from "@ayme-dev/example-certification/e2e/tests";

// The app turns the Agent Connection on unless built with
// `--mode inspector-disabled`, which neither the dev server nor the
// production build these tests run is.
agentConnectionTests({
  enabled: () => true,
  pageObject: "CounterPage",
  peek: true,
});
