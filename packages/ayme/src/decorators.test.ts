import { describe, expect, it } from "vitest";

import { ayme } from "./index";
import { availabilityPredicateOf } from "./decorators";

// Vitest does not compile decorator syntax, so these tests apply the
// decorators as each decorator mode calls them. The build integration's
// fixtures type-check the syntax in standard mode, and the packed-consumer
// test in legacy mode.
class Page {
  greet() {
    return "Hello.";
  }
}

const greet = Object.getOwnPropertyDescriptor(Page.prototype, "greet")!;
const classContext = {
  kind: "class",
  name: "Page",
} as ClassDecoratorContext<typeof Page>;
const methodContext = {
  kind: "method",
  name: "greet",
} as ClassMethodDecoratorContext<Page, () => string>;

describe("@ayme", () => {
  it("leaves the class unchanged in the bare form", () => {
    expect(ayme(Page)).toBeUndefined();
    expect(ayme(Page, classContext)).toBeUndefined();
  });

  it("returns a decorator that leaves the class unchanged in the options form", () => {
    const decorate = ayme({ description: "A page that greets." });

    expect(decorate(Page)).toBeUndefined();
    expect(decorate(Page, classContext)).toBeUndefined();
  });
});

describe("@ayme.action", () => {
  it("leaves the method unchanged in the bare form", () => {
    expect(ayme.action(Page.prototype, "greet", greet)).toBeUndefined();
    expect(ayme.action(Page.prototype.greet, methodContext)).toBeUndefined();
  });

  it.each([[undefined], [{}], [{ description: "Greet someone." }]])(
    "returns a decorator that leaves the method unchanged in the options form %j",
    (options) => {
      const decorate = ayme.action(options);

      expect(decorate(Page.prototype, "greet", greet)).toBeUndefined();
      expect(decorate(Page.prototype.greet, methodContext)).toBeUndefined();
      expect(new Page().greet()).toBe("Hello.");
    }
  );
});

describe("@ayme.action({ available })", () => {
  const canGreet = (self: Page) => self.greet() === "Hello." || "Not now";

  it("keeps the predicate for the method in both decorator modes", () => {
    class Legacy {
      greet() {
        return "Hello.";
      }
    }
    class Standard {
      greet() {
        return "Hello.";
      }
    }
    const legacyGreet = Object.getOwnPropertyDescriptor(
      Legacy.prototype,
      "greet"
    )!;

    expect(
      ayme.action({ available: canGreet })(
        Legacy.prototype,
        "greet",
        legacyGreet
      )
    ).toBeUndefined();
    expect(
      ayme.action({ available: canGreet })(
        Standard.prototype.greet,
        methodContext as ClassMethodDecoratorContext<Standard, () => string>
      )
    ).toBeUndefined();

    expect(availabilityPredicateOf(Legacy.prototype.greet)).toBe(canGreet);
    expect(availabilityPredicateOf(new Standard().greet)).toBe(canGreet);
    expect(new Legacy().greet()).toBe("Hello.");
  });

  it("keeps no predicate for an action without one", () => {
    class Plain {
      greet() {
        return "Hello.";
      }
    }
    ayme.action({ description: "Greet someone." })(
      Plain.prototype,
      "greet",
      Object.getOwnPropertyDescriptor(Plain.prototype, "greet")!
    );

    expect(availabilityPredicateOf(Plain.prototype.greet)).toBeUndefined();
    expect(availabilityPredicateOf(undefined)).toBeUndefined();
  });
});
