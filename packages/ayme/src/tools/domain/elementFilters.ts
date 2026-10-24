// The Browser Tools' element filters: which elements click, hover, type,
// fill, check, uncheck and select_option take. Rules over an element handed
// in; the Goal Loop offers a tool only the elements its filter keeps.

const INTERACTIVE_ROLE_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "select",
  "summary",
  "textarea",
  "[contenteditable='']",
  "[contenteditable='true']",
  "[contenteditable='plaintext-only']",
  "[role=button]",
  "[role=checkbox]",
  "[role=combobox]",
  "[role=link]",
  "[role=menuitem]",
  "[role=menuitemcheckbox]",
  "[role=menuitemradio]",
  "[role=option]",
  "[role=radio]",
  "[role=searchbox]",
  "[role=slider]",
  "[role=spinbutton]",
  "[role=switch]",
  "[role=tab]",
  "[role=textbox]",
].join(",");

/** Playwright fills these input types; any other type cannot be filled. */
const FILLABLE_INPUT_TYPES = new Set([
  "color",
  "date",
  "datetime-local",
  "email",
  "month",
  "number",
  "password",
  "range",
  "search",
  "tel",
  "text",
  "time",
  "url",
  "week",
]);

function isDisabled(element: Element): boolean {
  return element.matches(":disabled, [aria-disabled='true']");
}

/** The filter of click and hover: not disabled, interactive or pointer-cursored. */
export function isClickableElement(element: Element): boolean {
  if (isDisabled(element)) return false;
  return (
    element.matches(INTERACTIVE_ROLE_SELECTOR) ||
    element.ownerDocument.defaultView?.getComputedStyle(element).cursor ===
      "pointer"
  );
}

/** The filter of type and fill: an element text can actually be entered into. */
export function isFillableElement(element: Element): boolean {
  if (isDisabled(element)) return false;
  if (
    element.matches(
      "[contenteditable=''], [contenteditable='true'], [contenteditable='plaintext-only']"
    )
  )
    return true;
  if (element instanceof HTMLTextAreaElement) return !element.readOnly;
  if (element instanceof HTMLInputElement)
    return !element.readOnly && FILLABLE_INPUT_TYPES.has(element.type);
  return false;
}

const UNCHECKABLE_SELECTOR =
  "input[type=checkbox], [role=checkbox], [role=menuitemcheckbox], [role=switch]";

/** The filter of check: a checkbox, radio button or switch that is not disabled. */
export function isCheckableElement(element: Element): boolean {
  if (isDisabled(element)) return false;
  return element.matches(
    `${UNCHECKABLE_SELECTOR}, input[type=radio], [role=radio], [role=menuitemradio]`
  );
}

/** The filter of uncheck: a checkbox or switch; a radio button cannot be unchecked. */
export function isUncheckableElement(element: Element): boolean {
  return !isDisabled(element) && element.matches(UNCHECKABLE_SELECTOR);
}

/** The filter of select_option: a select element that is not disabled. */
export function isSelectElement(element: Element): boolean {
  return element instanceof HTMLSelectElement && !isDisabled(element);
}
