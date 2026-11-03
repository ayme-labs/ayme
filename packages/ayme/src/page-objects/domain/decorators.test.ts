import { describe, expect, it } from "vitest";

import { ayme } from "../../index";
import { availabilityPredicateOf, modelOption } from "./decorators";

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

describe("@ayme({ root, present }) stacked", () => {
  it("keeps the predicates each decorator supplied", () => {
    class Stacked {}
    const root = () => undefined as never;
    const present = () => true;
    ayme({ present })(Stacked, classContext as never);
    ayme({ root, present: undefined })(Stacked, classContext as never);

    expect(modelOption(Stacked, "root")).toBe(root);
    expect(modelOption(Stacked, "present")).toBe(present);
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

class Parts {
  readonly field = "value";
  get getter() {
    return "value";
  }
  items() {
    return ["value"];
  }
}

const getter = Object.getOwnPropertyDescriptor(Parts.prototype, "getter")!;
const items = Object.getOwnPropertyDescriptor(Parts.prototype, "items")!;
const fieldContext = {
  kind: "field",
  name: "field",
} as ClassFieldDecoratorContext<Parts, string>;
const getterContext = {
  kind: "getter",
  name: "getter",
} as ClassGetterDecoratorContext<Parts, string>;
const itemsContext = {
  kind: "method",
  name: "items",
} as ClassMethodDecoratorContext<Parts, () => string[]>;

describe.each(["child", "collection"] as const)("@ayme.%s", (marker) => {
  it("leaves fields and getters unchanged in the bare form", () => {
    const decorate = ayme[marker];

    expect(decorate(Parts.prototype, "field")).toBeUndefined();
    expect(decorate(Parts.prototype, "getter", getter)).toBeUndefined();
    expect(decorate(undefined, fieldContext)).toBeUndefined();
    expect(decorate(getter.get!, getterContext)).toBeUndefined();
  });

  it.each([[undefined], [{}], [{ description: "The part." }]])(
    "returns a decorator that leaves fields and getters unchanged in the options form %j",
    (options) => {
      const decorate = ayme[marker](options);

      expect(decorate(Parts.prototype, "field")).toBeUndefined();
      expect(decorate(Parts.prototype, "getter", getter)).toBeUndefined();
      expect(decorate(undefined, fieldContext)).toBeUndefined();
      expect(decorate(getter.get!, getterContext)).toBeUndefined();
      expect(new Parts().getter).toBe("value");
    }
  );
});

describe("@ayme.collection on a method", () => {
  it("leaves the method unchanged in the bare and options forms", () => {
    expect(ayme.collection(Parts.prototype, "items", items)).toBeUndefined();
    expect(
      ayme.collection(Parts.prototype.items, itemsContext)
    ).toBeUndefined();
    const decorate = ayme.collection({ description: "The items." });
    expect(decorate(Parts.prototype, "items", items)).toBeUndefined();
    expect(decorate(Parts.prototype.items, itemsContext)).toBeUndefined();
    expect(new Parts().items()).toEqual(["value"]);
  });
});
