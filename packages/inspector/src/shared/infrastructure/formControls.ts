import type { ControlState } from "../domain/controlState";

/**
 * Reads the state of each native form control by ref: inputs, textareas and
 * selects. Other elements, such as an ARIA checkbox, have none; the page
 * state alone describes them.
 */
export function readControls(
  elementsByRef: ReadonlyMap<string, Element>
): Map<string, ControlState> {
  const controls = new Map<string, ControlState>();
  const forms = new Map<HTMLFormElement | null, number>();
  for (const [ref, element] of elementsByRef) {
    const control = controlOf(element, (form) => {
      if (!forms.has(form)) forms.set(form, forms.size);
      return forms.get(form)!;
    });
    if (control) controls.set(ref, control);
  }
  return controls;
}

function controlOf(
  element: Element,
  formIndex: (form: HTMLFormElement | null) => number
): ControlState | undefined {
  if (element instanceof HTMLTextAreaElement)
    return { value: element.value, multiline: true };
  if (element instanceof HTMLSelectElement)
    return {
      value: element.selectedOptions[0]?.label ?? "",
      options: [...element.options].map((option) => option.label),
    };
  if (!(element instanceof HTMLInputElement)) return undefined;
  switch (element.type) {
    case "checkbox":
      return { value: String(element.checked) };
    case "radio":
      return {
        value: String(element.checked),
        ...(element.name
          ? { group: `${formIndex(element.form)}:${element.name}` }
          : {}),
      };
    case "range":
      return {
        value: element.value,
        range: {
          min: numberOr(element.min, 0),
          max: numberOr(element.max, 100),
          step:
            element.step.toLowerCase() === "any"
              ? "any"
              : numberOr(element.step, 1),
        },
      };
    default:
      return { value: element.value };
  }
}

function numberOr(text: string, fallback: number) {
  const value = Number.parseFloat(text);
  return Number.isFinite(value) ? value : fallback;
}
