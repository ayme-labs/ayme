import type { RefSource } from "../domain/refTree";
import { RefFieldView } from "../view/RefFieldView";
import { useRefField } from "./useRefField";

/**
 * The control of a ref field. Pressing it opens a searchable tree of the
 * page's structure right away; the crosshair beside it picks a ref by
 * pointing at the page.
 */
export function RefField({
  id,
  "aria-label": label,
  className,
  value,
  onChange,
  source,
}: {
  id?: string;
  "aria-label": string;
  className?: string;
  value: string;
  onChange: (ref: string | undefined) => void;
  source: RefSource;
}) {
  return (
    <RefFieldView
      id={id}
      aria-label={label}
      className={className}
      value={value}
      {...useRefField({ value, onChange, source })}
    />
  );
}
