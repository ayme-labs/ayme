import type { CollectionItem, ToolArguments } from "../../runs";

/** What a run card's Run does when pressed. */
export type Press =
  /** Nothing: the tool's Page Object is not on the page. */
  | { kind: "absent" }
  /**
   * Nothing: its last run is still running. Once it ends, the press opens the
   * form if `opensForm`.
   */
  | { kind: "busy"; opensForm: boolean }
  /** Opens the form, for the input the tool needs. */
  | { kind: "opens-form" }
  /**
   * Nothing: the input can't be sent as it is, or a collection action has no
   * item to run on.
   */
  | { kind: "blocked"; why: "invalid-input" | "no-item" }
  /** Runs the tool with its input, on the item for a collection action. */
  | { kind: "run"; input: ToolArguments; item?: CollectionItem };

/**
 * What pressing Run does, given the run card's state: nothing while the tool
 * is absent or running, then open the form when the tool needs input and the
 * form is closed, refuse while the input is invalid or a collection action
 * has no item, and otherwise run.
 */
export function press(card: {
  present: boolean;
  running: boolean;
  /** Whether the tool needs input the view doesn't give. */
  needsInput: boolean;
  /** Whether the form shows: opened under the head, or always without one. */
  formOpen: boolean;
  /** Whether the input can't be sent as it is. */
  invalid: boolean;
  args: ToolArguments;
  /** Whether it's a collection action, which runs on an item. */
  collection: boolean;
  /** For a collection action: the item it runs on, if any. */
  target: CollectionItem | undefined;
}): Press {
  if (!card.present) return { kind: "absent" };
  const opensForm = card.needsInput && !card.formOpen;
  if (card.running) return { kind: "busy", opensForm };
  if (opensForm) return { kind: "opens-form" };
  if (card.invalid) return { kind: "blocked", why: "invalid-input" };
  if (!card.collection) return { kind: "run", input: card.args };
  const { target } = card;
  if (!target) return { kind: "blocked", why: "no-item" };
  return {
    kind: "run",
    input: { ref: target.ref, args: card.args },
    item: target,
  };
}

/** Whether Run asks for the arguments first: it opens the form, now or once the run ends. */
export function asksForArguments(pressed: Press) {
  return (
    pressed.kind === "opens-form" ||
    (pressed.kind === "busy" && pressed.opensForm)
  );
}
