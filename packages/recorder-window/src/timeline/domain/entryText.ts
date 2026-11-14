import type { InteractionDetails } from "@ayme-dev/recorder/contract";

/** What an Interaction is called in the window, such as "Press Enter". */
export function interactionTitle(interaction: InteractionDetails): string {
  const { type, key, text } = interaction;
  if (type === "press" && typeof key === "string") return `Press ${key}`;
  if (type === "fill" && typeof text === "string") return `Fill '${text}'`;
  if (type === "assertVisible") return "Assert visible";
  return type.charAt(0).toUpperCase() + type.slice(1);
}

const ROLE = /^internal:role=([\w-]+)(?:\[name="((?:[^"\\]|\\.)*)"[is]?\])?$/;

/**
 * The target of an Interaction in the page structure's words, such as
 * `button "Add item"`: read from its selector when that names a role, the
 * selector as it is when not, its Structural Ref when there is no selector,
 * and null when there is neither.
 */
export function targetLabel(interaction: InteractionDetails): string | null {
  const selector = interaction.targetSelector;
  if (selector) {
    // Inside a frame, the last part names the element itself.
    const own = selector.split(" >> ").at(-1)!;
    const role = ROLE.exec(own);
    if (!role) return selector;
    return role[2] === undefined ? role[1]! : `${role[1]} "${role[2]}"`;
  }
  return interaction.targetRef ? `[ref=${interaction.targetRef}]` : null;
}
