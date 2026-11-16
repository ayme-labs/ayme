// Stryker disable all
// Page Object Roots in the document: what one probe of a root's Locator finds,
// measured in one task, and the labels a host's latest completed probe run
// gives the roots its captures place. Runs in the document, with nothing
// outside this file and what it imports.
import { isElementVisible } from "virtual:ayme-aria-snapshot";

import type { ReachMeasurement, RootState } from "../../shared";
import type { HostKey } from "./install";

export type { RootState };

/** What a host asks of a probe. */
export type ProbeRequest = {
  /** The Page Object the root belongs to: what its captures mark the root with. */
  label: string;
  /** The probe run this probe belongs to; without one the probe labels nothing. */
  round?: number;
};

type Entry = { label: string; element: WeakRef<Element>; present: boolean };

type Table = {
  /** The roots of the latest completed run. */
  current: Entry[];
  /** The roots of the run in progress, which replace `current` when it completes. */
  building?: { round: number; entries: Entry[] };
};

/** The roots a capture places: present ones with their labels, and absent ones. */
export type LabelledRoots = {
  roots: { label: string; element: Element }[];
  absent: Element[];
};

/**
 * The document's roots: probes, and each host's labels from its completed
 * probe runs, so a capture always reads the roots of one whole run.
 */
export function createRoots(deps: {
  measure(element: Element): ReachMeasurement;
  nameOf(element: Element): string;
}) {
  const tables = new Map<HostKey, Table>();

  function tableOf(host: HostKey): Table {
    let table = tables.get(host);
    if (!table) tables.set(host, (table = { current: [] }));
    return table;
  }

  function observe(element: Element): Omit<RootState, "count"> {
    const ref = deps.nameOf(element);
    // `locator.isVisible()`'s visibility, then reach as the layout stands.
    const measurement = isElementVisible(element)
      ? deps.measure(element)
      : undefined;
    if (!measurement?.present)
      return { present: false, available: false, ref, inTheWay: [] };
    const { available, blocker, hit } = measurement;
    return {
      present: true,
      available,
      ref,
      inTheWay: available ? [] : blocker ? [blocker] : [...(hit ?? [])],
    };
  }

  return {
    /** Probes the root the Locator's `elements` are, never scrolling or sending input. */
    probe(
      host: HostKey,
      elements: readonly Element[],
      { label, round }: ProbeRequest
    ): RootState {
      const [element] = elements;
      if (elements.length !== 1 || !element)
        return {
          count: elements.length,
          present: false,
          available: false,
          inTheWay: [],
        };
      const state = observe(element);
      if (round !== undefined) {
        const table = tableOf(host);
        if (table.building?.round !== round)
          table.building = { round, entries: [] };
        table.building.entries.push({
          label,
          element: new WeakRef(element),
          present: state.present,
        });
      }
      return { count: 1, ...state };
    },
    /** `host`'s run `round` completed: its roots are the ones captures place now. */
    endRound(host: HostKey, round: number): void {
      const table = tableOf(host);
      table.current =
        table.building?.round === round ? table.building.entries : [];
      table.building = undefined;
    },
    /** `host` stopped watching: its roots, current and pending, are gone. */
    forget(host: HostKey): void {
      tables.delete(host);
    },
    /** `host`'s roots as its latest completed run found them, still on the page. */
    labelled(host: HostKey): LabelledRoots {
      const roots: LabelledRoots["roots"] = [];
      const absent: Element[] = [];
      for (const { label, element, present } of tables.get(host)?.current ??
        []) {
        const found = element.deref();
        if (!found?.isConnected) continue;
        if (present) roots.push({ label, element: found });
        else absent.push(found);
      }
      const marked = new Set(roots.map(({ element }) => element));
      return {
        roots,
        absent: absent.filter((element) => !marked.has(element)),
      };
    },
  };
}
