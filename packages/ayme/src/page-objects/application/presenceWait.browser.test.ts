import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SETTLED_PAGE_DEADLINE_MS } from "@ayme-dev/core/structural-observation";

import { ayme } from "../domain/decorators";
import { registerCompiledPom } from "./compiledPoms";
import { createPage, probeRegisteredPomMembers } from "../infrastructure";
import { createAyme, type Ayme } from "../../runtime";

// Runtime seam: when a Run whose action returns a Page Object answers, as a
// Caller sees it: whether the page the action led to shows that Page Object
// by then.

/** Whether the screen the sign-in leads to is shown: what the presence predicates read. */
let homeShown = false;
const timers: ReturnType<typeof setTimeout>[] = [];
const showHomeAfter = (ms: number) =>
  timers.push(
    setTimeout(() => {
      homeShown = true;
    }, ms)
  );
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class Home {}
ayme({ present: () => homeShown })(Home);

// Its presence predicate is inherited from a base class of the app's own.
abstract class AppPage {}
ayme({ present: () => homeShown })(AppPage);
class Dashboard extends AppPage {}

// A presence predicate that never answers.
class Stuck {}
ayme({ present: () => new Promise<boolean>(() => {}) })(Stuck);

// No presence predicate of its own: decorated without one, or with a root alone.
class Plain {}
ayme(Plain);
class Rooted {
  readonly root = createPage().locator("#home");
}
ayme({ root: (self: Rooted) => self.root })(Rooted);

/** What `SignIn.logIn` does in a test: it shows Home after 700 ms and returns this. */
let logIn: () => Promise<unknown> = async () => {
  showHomeAfter(700);
  return new Home();
};

class SignIn {
  logIn() {
    return logIn();
  }
}
registerCompiledPom(SignIn, {
  className: "SignIn",
  members: [],
  tools: [
    {
      methodName: "logIn",
      toolName: "SignIn.logIn",
      description: "Log in.",
      parameters: [],
    },
  ],
  components: [],
});

describe("a Run whose action returns a Page Object", () => {
  let session: Ayme;
  let stop: () => void;

  beforeEach(async () => {
    homeShown = false;
    session = createAyme({ pageFactory: () => createPage() });
    stop = session.start();
    session.pom.register(SignIn);
    await probeRegisteredPomMembers();
  });

  afterEach(() => {
    timers.splice(0).forEach(clearTimeout);
    session.pom.unregister(SignIn);
    stop();
  });

  it.each([
    ["declares", () => new Home()],
    ["inherits", () => new Dashboard()],
  ])(
    "answers once the presence predicate its model %s holds",
    async (_label, returned) => {
      logIn = async () => {
        showHomeAfter(700);
        return returned();
      };

      await session.tools.run("SignIn.logIn", {});

      expect(homeShown).toBe(true);
    }
  );

  it("answers at the Settled Page deadline when the predicate never holds", async () => {
    logIn = async () => new Home();
    const started = Date.now();

    await session.tools.run("SignIn.logIn", {});

    const took = Date.now() - started;
    expect(took).toBeGreaterThanOrEqual(SETTLED_PAGE_DEADLINE_MS);
    expect(took).toBeLessThan(2 * SETTLED_PAGE_DEADLINE_MS);
  });

  it("answers at the Settled Page deadline when the predicate never answers", async () => {
    logIn = async () => new Stuck();
    const started = Date.now();

    await session.tools.run("SignIn.logIn", {});

    expect(Date.now() - started).toBeLessThan(2 * SETTLED_PAGE_DEADLINE_MS);
  });

  it("answers at the start of a full load without waiting, since the browser runtime ends with its document", async () => {
    // The test server drops the load (vitest.browser.config.ts), so the
    // document stays to read the answer; the action returns 1.2 s after.
    logIn = async () => {
      location.assign("/__no-content");
      await sleep(1200);
      return new Home();
    };
    const started = Date.now();

    const result = await session.tools.run("SignIn.logIn", {});

    expect(result).toMatchObject({ loading: expect.any(String) });
    expect(Date.now() - started).toBeLessThan(1200);
  });

  it.each([
    ["a Page Object decorated without a presence predicate", () => new Plain()],
    ["a Page Object with a root alone", () => new Rooted()],
    ["nothing", () => undefined],
  ])(
    "answers without waiting when the action returns %s",
    async (_label, returned) => {
      logIn = async () => {
        showHomeAfter(700);
        return returned();
      };

      await session.tools.run("SignIn.logIn", {});

      expect(homeShown).toBe(false);
    }
  );
});
