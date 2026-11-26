import { server } from "@ayme-dev/example-certification/config";
import { agentConnectionTests } from "@ayme-dev/example-certification/tests";

// The playground turns the Agent Connection on unless built with
// `--mode inspector-disabled`. Its Peek check renders only in development.
agentConnectionTests({
  enabled: () => true,
  pageObject: "ListPage",
  peek: server === "dev",
});
