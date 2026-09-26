import type { ComponentProps, ReactNode } from "react";

import { cn } from "@ayme-dev/design-system/lib/utils";

export function Json({
  value,
  className,
  ...props
}: { value: unknown } & ComponentProps<"pre">) {
  return (
    <pre
      className={cn(
        "max-h-96 overflow-auto rounded-md bg-muted p-2 font-mono text-xs whitespace-pre-wrap",
        className
      )}
      {...props}
    >
      {value === undefined ? "undefined" : JSON.stringify(value, null, 2)}
    </pre>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}
