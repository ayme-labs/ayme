import {
  StructuralTree,
  SyntheticAriaRefFactory,
} from "@ayme-dev/core/structural-observation";
import { expect, it } from "vitest";

import type { DocumentToken } from "../../shared";
import { readPageObjectTree } from "./pageObjectTree";
import type { PageObjectIds } from "./pageObjectIds";

const tree = StructuralTree.fromAriaSnapshotYaml(
  '- button "Add" [ref=e1]',
  new SyntheticAriaRefFactory()
);
const driver = { refs: async () => [], currentRefs: async () => [] };
const ids = { rootsOf: async () => [] } as unknown as PageObjectIds;

// A tool's answer compares the documents of the reads before and after its
// action to tell a full load, so a read names the one its capture was of.
it("names the document its capture was of, and none when the capture names none", async () => {
  const document = "document-2" as DocumentToken;

  const read = await readPageObjectTree(driver, [], ids, async () => ({
    tree,
    document,
  }));
  const unnamed = await readPageObjectTree(driver, [], ids, async () => ({
    tree,
  }));

  expect(read.document).toBe(document);
  expect(unnamed).not.toHaveProperty("document");
});
