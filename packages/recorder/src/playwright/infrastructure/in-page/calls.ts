/// <reference lib="dom" />

import type { Gate } from "./gate";

// The calls the stock adapter makes into a recorded page, one function each.
// Each is sent to the page as its own text, so it uses nothing from outside
// itself but its argument (docs/testing.md#code-a-real-browser-runs).

export function watchActivity(on: boolean): void {
  window.__aymeRecorderActivity?.watch(on);
}

/** The one call inside a snapshot's mark in the trace. */
export function markCall(): number {
  return 0;
}

export function setGate(on: boolean): void {
  window.__aymeRecorderGate?.set(on);
}

/** Lets the document's gate let through what follows the `upTo`th input. */
export function letGateThrough(upTo: number): void {
  window.__aymeRecorderGate?.letThrough(upTo);
}

/** Leaves the document's inputs to Playwright's picking, or no longer. */
export function pickWithGate(on: boolean): void {
  window.__aymeRecorderGate?.pick(on);
}

/** Which of the elements a selector matches is the one picked at the
 * picking click: the nearest around the element under the mouse then,
 * through open shadow roots, itself included; -1 for none. */
export function pickedAmong(elements: Element[]): number {
  const self = window as unknown as { __aymeRecorderPicked?: Element };
  const above = (at: Element) =>
    at.parentElement ?? ((at.getRootNode() as ShadowRoot).host || null);
  const around: Element[] = [];
  for (let at = self.__aymeRecorderPicked ?? null; at; at = above(at))
    around.push(at);
  const picked = around.find((at) => elements.includes(at));
  return picked ? elements.indexOf(picked) : -1;
}

/** Opens the document's gate for a held input on its way; false when the
 * document has no gate, or it was held in another document. */
export function openGate(input: {
  at: Parameters<Gate["open"]>[0];
  document: string;
}): Promise<boolean> | boolean {
  return window.__aymeRecorderGate?.open(input.at, input.document) ?? false;
}

/** Closes the document's gate after an input that never arrived. */
export function closeGate(): void {
  window.__aymeRecorderGate?.close();
}

/** The names of the files a file input holds; null for anything else. */
export function fileNamesIn(input: Element): string[] | null {
  return input instanceof HTMLInputElement && input.files
    ? [...input.files].map((file) => file.name)
    : null;
}

/** Where a frame's document starts inside its frame element: past its
 * border and padding. */
export function frameContentOffset(node: Element): { x: number; y: number } {
  const box = node.getBoundingClientRect();
  const style = getComputedStyle(node);
  return {
    x: box.left + node.clientLeft + parseFloat(style.paddingLeft),
    y: box.top + node.clientTop + parseFloat(style.paddingTop),
  };
}

/** The boxes of elements in their document's viewport; an element that
 * takes no room, as one hidden, has none. */
export function boxesIn(
  elements: Element[]
): { x: number; y: number; width: number; height: number }[] {
  return elements
    .map((element) => element.getBoundingClientRect())
    .filter((box) => box.width > 0 && box.height > 0)
    .map(({ x, y, width, height }) => ({ x, y, width, height }));
}

/** Switches the gate, the activity watch and the target watch off, for a
 * browser the adapter lets go of. */
export function stopGateAndWatch(): void {
  window.__aymeRecorderGate?.set(false);
  window.__aymeRecorderActivity?.watch(false);
  window.__aymeRecorderTargetWatch?.stop();
}

/** Takes the recorder's own highlight away, and tells its toolbar, by the
 * event named `remove`, to take itself away. */
export function removeOwnElements(remove: string): void {
  document.querySelector("ayme-recorder-highlight")?.remove();
  document
    .querySelector("ayme-recorder-toolbar")
    ?.dispatchEvent(new Event(remove));
}

/**
 * Runs in a document once Playwright's recorder has been switched off:
 * resolves when the document's part of it has heard so, and takes away the
 * mark it leaves on the body, which makes every element look clickable.
 * Private parts of Playwright (ADR-0052): the document asks for the
 * recorder's state on its own, through a binding of Playwright's; asking
 * once more and getting the answer means the document's own earlier
 * question was answered first.
 */
export async function askRecorderState(): Promise<void> {
  const state = (
    window as unknown as { __pw_recorderState?: () => Promise<unknown> }
  ).__pw_recorderState;
  if (state) await state();
}

export async function noLongerRecording(): Promise<void> {
  const state = (
    window as unknown as { __pw_recorderState?: () => Promise<unknown> }
  ).__pw_recorderState;
  if (state) await state();
  document.body?.removeAttribute("data-pw-cursor");
}
