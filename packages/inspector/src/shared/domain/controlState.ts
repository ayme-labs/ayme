/**
 * A form control's state that the page state leaves out or flattens, read
 * from the element itself: a textarea's line breaks, a slider's range, a
 * select's options and which radios belong together.
 */
export type ControlState = {
  /**
   * Its value as `fill_form` takes it: the text, `"true"` or `"false"` for a
   * checkbox or radio, the selected option's label for a select.
   */
  value: string;
  /** Whether the text can hold line breaks: a textarea. */
  multiline?: boolean;
  /** A select's option labels. */
  options?: string[];
  /** A range input's bounds and step. */
  range?: { min: number; max: number; step: number | "any" };
  /** A radio's group: radios with the same name in the same form. */
  group?: string;
};
