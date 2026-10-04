import {
  listRegisteredPomTargets,
  listRegisteredPoms,
} from "@ayme-dev/ayme/internal";

import { indexMembers } from "../../page-model/domain/memberIndex";
import { buildPageModel } from "../../page-model/domain/pageModel";
import type { RunStep, TraceEntry } from "../domain/run";
import { traceEntryLocator } from "./trace";

/** The elements a step's locator matches on the page now. */
async function elementsOf(step: TraceEntry): Promise<Element[]> {
  const locator = traceEntryLocator(step);
  if (!locator) return [];
  try {
    // A page function's result is serialized, so it names each element by
    // its place in the document. The Inspector's own elements, inside its
    // shadow root, have none.
    const places = await locator.evaluateAll((elements) => {
      const all = [...document.getElementsByTagName("*")];
      return elements.map((element) => all.indexOf(element));
    });
    const all = document.getElementsByTagName("*");
    return places.flatMap((place) => {
      const element = place === -1 ? undefined : all[place];
      return element ? [element] : [];
    });
  } catch {
    return [];
  }
}

/**
 * Names the member each step acted on, where its element is still there,
 * from the registry as the run left it: a member the run added, such as a
 * new item, is named too.
 */
export async function describeSteps(
  steps: readonly TraceEntry[]
): Promise<RunStep[]> {
  if (!steps.length) return [];
  let targets: Awaited<ReturnType<typeof listRegisteredPomTargets>> = [];
  try {
    targets = await listRegisteredPomTargets();
  } catch {
    // Without the registry's targets, steps keep their locators.
  }
  const members = indexMembers(
    buildPageModel(listRegisteredPoms(), new Set(), [])
  );
  const memberOf = (targetPath: string) => members.member(targetPath)?.path;
  return await Promise.all(
    steps.map(async (step) => {
      const elements = await elementsOf(step);
      // The first member the registry lists for an element is its own.
      const member = targets
        .filter(({ element }) => elements.includes(element))
        .map(({ path }) => memberOf(path))
        .find((path) => path !== undefined);
      return member === undefined ? { ...step } : { ...step, member };
    })
  );
}
