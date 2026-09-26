import type { ComponentProps, ReactNode } from "react";

import { Badge } from "@ayme-dev/design-system/components/badge";
import { cn } from "@ayme-dev/design-system/lib/utils";

import type { Run } from "./useRuns";

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

const runStatusVariant = {
  running: "outline",
  succeeded: "secondary",
  failed: "destructive",
} as const;

export function RunStatus({ run }: { run: Run }) {
  return (
    <Badge variant={runStatusVariant[run.status]} data-run-status={run.status}>
      {run.status}
    </Badge>
  );
}

export function Section({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}
