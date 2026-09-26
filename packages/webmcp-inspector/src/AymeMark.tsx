import {
  AYME_LOGO_FILL,
  AYME_LOGO_PATH,
  AYME_LOGO_VIEWBOX,
} from "@ayme-dev/design-system/logo";

export function AymeMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox={AYME_LOGO_VIEWBOX}
      aria-hidden="true"
      focusable="false"
    >
      <path d={AYME_LOGO_PATH} fill={AYME_LOGO_FILL} />
    </svg>
  );
}
