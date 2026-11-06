import type { Locator } from "@playwright/test";
import type { LatestRefByRef } from "../../page-state/domain";
import type { RootState } from "../../shared";

/**
 * Package-internal: what reading Page Objects needs of the page they are
 * read on. One driver over the in-page module serves the browser runtime,
 * over Playwright Lite, and Node, over Playwright; no element crosses it.
 */
export type PageDriver = {
  /** Whether `value`, a member or a root predicate answered, is a locator. */
  isLocator(value: unknown): value is Locator;
  /**
   * Probes one Page Object Root without scrolling or sending input, in one
   * task in the page: how many elements its locator matched and, for one
   * element, whether it is present and available (ADR-0035) and its ref.
   * Inside a probe run of `watch`, it also labels the root in later captures.
   */
  probe(root: Locator, label: string): Promise<RootState>;
  /** The Structural Ref of each element `locator` resolves to now. */
  refs(locator: Locator): Promise<string[]>;
  /** Whether `ref`, now or before, names the one element `locator` resolves to. */
  names(locator: Locator, ref: string): Promise<boolean>;
  /**
   * Runs `probe` now and after every change of the page, one run at a time,
   * until the returned function stops the watch. A change during a run is
   * one follow-up.
   */
  watch(probe: (signal: AbortSignal) => Promise<void>): () => void;
  /** Makes a probe run due, as when a Page Object is registered. */
  refresh(): void;
  /** Resolves once no probe run is due, as a capture needs the roots. */
  probed(): Promise<void>;
  /**
   * The Structural Ref the agent's latest recorded page state gave what
   * `ref` names, when it gave it one: what names an element in the way.
   */
  latestPageStateRef: LatestRefByRef;
};
