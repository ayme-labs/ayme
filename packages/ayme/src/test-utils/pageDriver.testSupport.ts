/**
 * Test support: the page driver of unit tests, which have no in-page module
 * to probe. Elements are fakes a test hands out through `elementsOf`, named
 * by refs of the stand-in's own, and a probe reads them as `measure` says
 * the layout shows them.
 */
import type { Locator } from "@playwright/test";

import type { PageDriver } from "../page-objects/application";
import type { RootState } from "../shared";

const refsByElement = new WeakMap<object, string>();
let minted = 0;

/** The ref the stand-in names `element` by, the same one each time. */
export function refOf(element: Element): string {
  let ref = refsByElement.get(element);
  if (ref === undefined) {
    ref = `t_${++minted}`;
    refsByElement.set(element, ref);
  }
  return ref;
}

/** Names `element` by `ref`, as a page that marked it in a capture does. */
export function nameElement(element: Element, ref: string): void {
  refsByElement.set(element, ref);
}

/** What a root measures as: present and reached unless a test says otherwise. */
export type StandInMeasure = (element: Element) => {
  present: boolean;
  available: boolean;
  inTheWay?: string[];
};

export type StandInPageDriver = PageDriver & {
  /** The page changed: a probe run follows. */
  trigger(): void;
};

/**
 * The module `vi.mock` puts in place of inPageDriver.ts for a test that
 * registers Page Objects holding no locator: the registry then watches a
 * page it never reads.
 */
export function standInDriverModule() {
  return {
    inPageDriver: () =>
      standInPageDriver({ isLocator: () => false, elementsOf: () => [] }),
  };
}

const latest = Symbol.for("ayme.test.latestStandInPageDriver");

/**
 * The latest stand-in driver built, for a test that reaches it through the
 * registry's module, which a module reset gives a copy of its own.
 */
export function latestStandIn(): StandInPageDriver | undefined {
  return (globalThis as { [latest]?: StandInPageDriver })[latest];
}

export function standInPageDriver(deps: {
  isLocator(value: unknown): boolean;
  elementsOf(locator: Locator): Element[];
  measure?: StandInMeasure;
}): StandInPageDriver {
  const measure: StandInMeasure =
    deps.measure ?? (() => ({ present: true, available: true }));
  let watching:
    | {
        schedule(): void;
        run(): Promise<void>;
        due(): boolean;
        running(): Promise<void> | undefined;
      }
    | undefined;

  /** The refs of the locator's elements; a test's `count` stands for how many there are. */
  async function refsOf(locator: Locator): Promise<string[]> {
    const elements = deps.elementsOf(locator);
    const count = await locator.count();
    return Array.from({ length: count }, (_, index) => {
      const element = elements[index];
      return element ? refOf(element) : `t_missing_${index}`;
    });
  }

  const driver: StandInPageDriver = {
    isLocator: (value): value is Locator => deps.isLocator(value),
    async probe(locator): Promise<RootState> {
      const refs = await refsOf(locator);
      const element = deps.elementsOf(locator)[0];
      if (refs.length !== 1 || !element)
        return {
          count: refs.length,
          present: false,
          available: false,
          inTheWay: [],
        };
      const { present, available, inTheWay = [] } = measure(element);
      return {
        count: 1,
        present,
        available: present && available,
        ref: refs[0],
        inTheWay,
      };
    },
    refs: refsOf,
    // A stand-in ref never changes name: a capture has marked nothing.
    currentRefs: async (refs) => [...refs],
    async names(locator, ref) {
      const refs = await refsOf(locator);
      return refs.length === 1 && refs[0] === ref;
    },
    watch(probe) {
      const controller = new AbortController();
      let running: Promise<void> | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let due = true;
      const run = (): Promise<void> => {
        if (running) return running;
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
        due = false;
        running = Promise.resolve()
          .then(() => probe(controller.signal))
          .finally(() => {
            running = undefined;
            if (due && !controller.signal.aborted) schedule();
          });
        return running;
      };
      const schedule = () => {
        due = true;
        if (running || timer !== undefined || controller.signal.aborted) return;
        timer = setTimeout(() => {
          timer = undefined;
          void run().catch(() => {});
        }, 0);
      };
      const handle = { schedule, run, due: () => due, running: () => running };
      watching = handle;
      schedule();
      return () => {
        controller.abort();
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
        if (watching === handle) watching = undefined;
      };
    },
    refresh: () => watching?.schedule(),
    async probed() {
      const current = watching;
      if (!current) return;
      // The run in progress, then at most one follow-up.
      for (let runs = 0; runs < 2 && watching === current; runs += 1) {
        const going = current.running();
        if (going) await going;
        else if (current.due()) await current.run();
        else return;
      }
    },
    latestPageStateRef: () => undefined,
    trigger: () => watching?.schedule(),
  };
  (globalThis as { [latest]?: StandInPageDriver })[latest] = driver;
  return driver;
}
