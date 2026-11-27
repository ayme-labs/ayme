// The fixtures check-goal-mirror knows: testIn makes tests, and
// confirmGoalRecordings ends each one.
import type { Inspector } from "./pom/Inspector";

type Fixtures = {
  agent: { act: (goal: string, options?: object) => Promise<void> };
  browser: object;
  inspector: Inspector;
};
type Body = (fixtures: Fixtures) => Promise<void>;

export function testIn(placement: "inline" | "external") {
  const test = (title: string, body: Body) => [placement, title, body];
  return Object.assign(test, { skip: test });
}

export async function confirmGoalRecordings(browser: object) {
  return browser;
}
