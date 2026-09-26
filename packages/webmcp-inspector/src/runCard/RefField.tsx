import type { ComponentProps } from "react";

import { cn } from "@ayme-dev/design-system/lib/utils";

/**
 * The control of a ref field: for now a plain text input for a Structural
 * Ref, e.g. e12. Ticket R replaces it with ref picking; the form chooses it by
 * the field's kind and gives it only what any control gets.
 */
export function RefField({
  value,
  onChange,
  className,
  ...props
}: Omit<ComponentProps<"input">, "value" | "onChange"> & {
  value: string;
  onChange: (ref: string | undefined) => void;
}) {
  return (
    <input
      type="text"
      spellCheck={false}
      placeholder="e12"
      value={value}
      onChange={(event) => onChange(event.target.value || undefined)}
      className={cn(className, "font-mono")}
      {...props}
    />
  );
}
