import type { InteractionDetails } from "@ayme-dev/recorder/contract";

/** What an Interaction is called in the window, such as "Press Enter",
 * "Right-click" or "Middle-click". */
export function interactionTitle(interaction: InteractionDetails): string {
  const { type, key, text, button } = interaction;
  if (type === "click" && button === "right") return "Right-click";
  if (type === "click" && button === "middle") return "Middle-click";
  if (type === "press" && typeof key === "string") return `Press ${key}`;
  if (type === "fill" && typeof text === "string") return `Fill '${text}'`;
  if (type === "assertVisible") return "Assert";
  return type.charAt(0).toUpperCase() + type.slice(1);
}
