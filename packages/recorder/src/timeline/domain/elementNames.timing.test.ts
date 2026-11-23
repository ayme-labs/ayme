import {
  StructuralTree,
  SyntheticAriaRefFactory,
  type StructuralNode,
} from "@ayme-dev/core/structural-observation";
import { writeFileSync } from "node:fs";
import { it } from "vitest";

import { labelOf } from "./elementNames";

/**
 * How long labelling every element of a large list takes, by the shape of
 * its items. Each run reads the list afresh and labels each of its
 * elements once, as the rows of a page that shows the whole list at once
 * are labelled.
 *
 * It runs only with `AYME_LABEL_TIMING` set to the file it writes the
 * times to: for each shape and count, the least and the most of `REPEATS`
 * runs after `WARM_UPS` runs, and their median. From this package's
 * directory:
 *
 *     AYME_LABEL_TIMING=label-timing.txt pnpm exec vitest run src/timeline/domain/elementNames.timing.test.ts
 *
 * Times depend on the machine and on what else runs on it: compare the
 * shapes of one run, not runs on different machines.
 */

const WARM_UPS = 5;
const REPEATS = 15;
const COUNTS = [1000, 2000];

/** An item's lines, below its unnamed `listitem`, by its place in the
 * list. `[ref]` takes the next ref. */
type Item = (at: number) => string[];

const shapes: Record<string, Item> = {
  "repeated text": () => [`- checkbox "Toggle Todo" [ref]`, `- text: buy milk`],
  "distinct text": (at) => [
    `- checkbox "Toggle Todo" [ref]`,
    `- text: todo ${at + 1}`,
  ],
  "distinct headings": (at) => [`- heading "Item ${at + 1}" [level=3] [ref]`],
  "distinct headings, same text": (at) => [
    `- heading "Item ${at + 1}" [level=3] [ref]`,
    `- paragraph [ref]: In stock`,
  ],
  "distinct headings and text": (at) => [
    `- heading "Item ${at + 1}" [level=3] [ref]`,
    `- paragraph [ref]: Details of item ${at + 1}`,
  ],
  // Text in an element with no role, labelled by its text alone.
  "distinct headings and text, no role": (at) => [
    `- generic [ref]:`,
    `  - heading "Item ${at + 1}" [level=3] [ref]`,
    `  - text: Details of item ${at + 1}`,
  ],
};

/** A page of one list of `count` items, as Playwright's AI-mode snapshot
 * writes it. */
function listOf(count: number, item: Item): string {
  let ref = 3;
  const lines = [`- generic [ref=e1]:`, `  - list [ref=e2]:`];
  for (let at = 0; at < count; at++)
    lines.push(
      `    - listitem [ref=e${ref++}]:`,
      ...item(at).map(
        (line) => `      ${line.replace("[ref]", `[ref=e${ref++}]`)}`
      )
    );
  return lines.join("\n");
}

/** Milliseconds to label every element of a fresh read of `yaml`. */
function labelEvery(yaml: string): number {
  const tree = StructuralTree.fromAriaSnapshotYaml(
    yaml,
    new SyntheticAriaRefFactory()
  );
  const nodes: StructuralNode[] = [];
  tree.walk((node) => nodes.push(node));
  const start = performance.now();
  for (const node of nodes) labelOf(tree, node);
  return performance.now() - start;
}

const out = process.env.AYME_LABEL_TIMING;

it.runIf(out)(
  "times labelling every element of a large list",
  { timeout: 600_000 },
  () => {
    const lines = [`shape, items: least–most ms of ${REPEATS} (median)`];
    for (const [name, item] of Object.entries(shapes))
      for (const count of COUNTS) {
        const yaml = listOf(count, item);
        for (let run = 0; run < WARM_UPS; run++) labelEvery(yaml);
        const times = Array.from({ length: REPEATS }, () =>
          labelEvery(yaml)
        ).sort((a, b) => a - b);
        const ms = (time: number) => time.toFixed(1);
        lines.push(
          `${name}, ${count}: ${ms(times[0]!)}–${ms(times.at(-1)!)} (${ms(times[REPEATS >> 1]!)})`
        );
      }
    writeFileSync(out!, `${lines.join("\n")}\n`);
  }
);
