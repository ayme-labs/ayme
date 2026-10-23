// The panel's shared control states, so a state looks the same on every
// control that has it.
// Stryker disable StringLiteral: Tailwind classes are styling, which no test reads.

/**
 * The focus ring: solid, so it reaches 3:1 against the panel, like the
 * inputs' borders.
 */
export const focusRing =
  "outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * The focus ring of a full-width row, drawn inside it so the scroller the
 * row sits in doesn't clip it.
 */
export const rowFocusRing = `${focusRing} focus-visible:ring-inset`;

/**
 * Press feedback: the control shrinks a little while it's pressed, so the
 * panel answers on pointer-down. Reduced motion keeps the colour change and
 * drops the scale.
 */
export const pressable =
  "transition-[scale,background-color,border-color,color] duration-(--duration-fast) ease-(--ease-out) motion-safe:active:scale-[0.97]";

/**
 * Press feedback for an icon-only button, scaled further: 0.97 of 28px is
 * under a pixel.
 */
export const pressableIcon =
  "transition-[scale,background-color,color] duration-(--duration-fast) ease-(--ease-out) motion-safe:active:scale-95";

/**
 * A chip that opens what it names, a page object or a model, with its
 * focus ring and press feedback: one shape wherever it shows.
 */
export const chip = `inline-flex h-6 items-center gap-1 rounded-full border bg-card px-2 text-xs hover:border-ring ${focusRing} ${pressable}`;

/**
 * Press feedback for a full-width row in a tree or list: its background
 * changes the instant it's pressed, with no transition, so the row answers
 * on pointer-down without moving the rows around it.
 */
export const rowPress = "active:bg-accent";

// Stryker restore StringLiteral
