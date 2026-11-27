import { expect, it } from "vitest";

import { swapClasses } from "./swapClasses";

// The Swap on a Tab's Node Host: its runtime's own registrations, which
// keep the page's registry and its Page Object Ids, swapped class by class.

class OldBasket {}
class OldShop {}
class NewBasket {}
class NewShop {}

/** A Node Host's registrations, as its runtime's `pom` keeps them; a class
 * in `refused` throws as it registers, as a constructor that throws. */
function nodeHostPom(running: readonly unknown[], refused?: unknown) {
  const registered = new Set(running);
  return {
    registered,
    register(model: unknown) {
      if (model === refused) throw new Error("NewShop could not be made.");
      registered.add(model);
    },
    unregister(model: unknown) {
      registered.delete(model);
    },
  };
}

it("unregisters every class the Host ran before registering the rebuilt ones, so a class keeps its name and registers once", () => {
  const pom = nodeHostPom([OldBasket, OldShop]);

  swapClasses(pom, [OldBasket, OldShop], [NewBasket, NewShop]);

  expect([...pom.registered]).toEqual([NewBasket, NewShop]);
});

it("keeps the classes the Host ran when a rebuilt one cannot register, and says why", () => {
  const pom = nodeHostPom([OldBasket, OldShop], NewShop);

  expect(() =>
    swapClasses(pom, [OldBasket, OldShop], [NewBasket, NewShop])
  ).toThrow("NewShop could not be made.");
  expect([...pom.registered]).toEqual([OldBasket, OldShop]);
});
