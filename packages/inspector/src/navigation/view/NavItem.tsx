import type { ComponentProps } from "react";

import { cn } from "@ayme-dev/design-system/lib/utils";

/** A row in a navigator tree or list. */
export function NavItem({
  selected,
  depth = 0,
  className,
  ...props
}: ComponentProps<"button"> & { selected: boolean; depth?: number }) {
  return (
    <button
      type="button"
      aria-current={selected || undefined}
      className={cn(
        "flex h-7.5 w-full items-center gap-1.75 rounded-md px-2 text-left hover:bg-muted",
        selected && "bg-accent hover:bg-accent",
        className
      )}
      style={{ paddingLeft: 8 + depth * 16 }}
      {...props}
    />
  );
}
