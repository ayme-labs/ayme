import {
  AYME_LOGO_FILL,
  AYME_LOGO_PATH,
  AYME_LOGO_VIEWBOX,
} from "@ayme-dev/design-system/logo";

/**
 * The ayme mark, in the brand colour unless a `fill-*` class on it says
 * otherwise (a CSS fill outranks the SVG attribute).
 */
export function AymeMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox={AYME_LOGO_VIEWBOX}
      fill={AYME_LOGO_FILL}
      aria-hidden="true"
      focusable="false"
    >
      <path d={AYME_LOGO_PATH} />
    </svg>
  );
}
