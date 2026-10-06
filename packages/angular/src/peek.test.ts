// @vitest-environment jsdom
// Angular 19 needs Zone.js to bootstrap; later majors run zoneless with it
// loaded too. JIT compiles the test components.
import "zone.js";
import "@angular/compiler";
import {
  Component,
  createComponent,
  runInInjectionContext,
  signal,
  type ApplicationRef,
  type ComponentRef,
  type Type,
} from "@angular/core";
import { createApplication } from "@angular/platform-browser";
import type { AymeOptions } from "@ayme-dev/ayme";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { injectAyme, injectPeek, provideAyme } from "./index";

// injectPeek seam: its contract with `ayme.peek`, which it adapts (ADR-0031).
// The Peek Tool an agent reads is covered by the runtime's browser tests and
// the example's Agent Connection suite; here the dev gate stays off, so no
// Agent Connection loads or scans.
type Page = ReturnType<NonNullable<AymeOptions["pageFactory"]>>;
const pageFactory = () => ({ url: () => "page" }) as unknown as Page;
type PeekCall = { read: () => unknown; name: string; id?: string };

let app: ApplicationRef;
let calls: PeekCall[];
let removed: PeekCall[];
beforeEach(async () => {
  calls = [];
  removed = [];
  app = await createApplication({ providers: [provideAyme({ pageFactory })] });
  const { ayme } = runInInjectionContext(app.injector, injectAyme);
  vi.spyOn(ayme, "peek").mockImplementation((read, name, id) => {
    const call = { read, name, id };
    calls.push(call);
    return () => void removed.push(call);
  });
});
afterEach(() => app.destroy());

function mount<T>(component: Type<T>): ComponentRef<T> {
  const ref = createComponent(component, {
    environmentInjector: app.injector,
  });
  app.attachView(ref.hostView);
  return ref;
}

// Vitest's transform has no decorators, so the components are decorated by call.
const Counter = Component({ selector: "test-counter", template: "" })(
  class {
    readonly count = signal(0);
    constructor() {
      injectPeek({ count: this.count, label: "counter" }, "counter");
    }
  }
);

it("adds one instance per component after it renders, under its own id, reading its signals when asked", () => {
  const first = mount(Counter);
  mount(Counter);
  expect(calls).toEqual([]);

  app.tick();

  expect(calls.map(({ name }) => name)).toEqual(["counter", "counter"]);
  expect(calls[0]!.id).toEqual(expect.any(String));
  expect(calls[0]!.id).not.toBe(calls[1]!.id);
  first.instance.count.set(4);
  expect(calls.map(({ read }) => read())).toEqual([
    { count: 4, label: "counter" },
    { count: 0, label: "counter" },
  ]);
});

const Cart = Component({ selector: "test-cart", template: "" })(
  class {
    readonly items = signal(["apple"]);
    constructor() {
      injectPeek(this.items, "cart", "cart-7");
    }
  }
);

it("uses the id it is given and reads a signal passed as the values", () => {
  const cart = mount(Cart);
  app.tick();

  cart.instance.items.set(["apple", "pear"]);

  expect(calls.map(({ name, id }) => ({ name, id }))).toEqual([
    { name: "cart", id: "cart-7" },
  ]);
  expect(calls[0]!.read()).toEqual(["apple", "pear"]);
});

it("removes the instance when the component is destroyed", () => {
  const counter = mount(Counter);
  app.tick();

  counter.destroy();

  expect(removed).toEqual(calls);
});

it("adds nothing for a component destroyed before it renders", () => {
  mount(Counter).destroy();

  app.tick();

  expect(calls).toEqual([]);
});
