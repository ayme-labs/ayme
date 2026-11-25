import { cn } from "@ayme-dev/design-system/lib/utils";

import { splitQualifiedName } from "../domain/qualifiedName";

/**
 * A qualified name on one line, such as a tool's name or a Page Object's
 * path. Short of room, the part before its last `.` gives way first, muted,
 * so names that share a long prefix still tell apart by their last segment;
 * that segment is cut only once the prefix is gone. A name that is no path
 * is cut at its end. Its title is the name in full, unless the control it
 * names gives a longer one.
 *
 * Its two parts are blocks, so an accessible name read from them gets a
 * space between them: a control named by the name alone takes it as its
 * `aria-label`.
 */
export function QualifiedName({
  name,
  title = name,
  className,
}: {
  name: string;
  title?: string;
  className?: string;
}) {
  const parts = splitQualifiedName(name);
  if (!parts)
    return (
      // Stryker disable next-line StringLiteral: Tailwind classes are styling, which no test reads.
      <span className={cn("min-w-0 truncate", className)} title={title}>
        {name}
      </span>
    );
  return (
    // Stryker disable next-line StringLiteral: Tailwind classes are styling, which no test reads.
    <span className={cn("flex min-w-0", className)} title={title}>
      <span className="min-w-0 shrink-[1000] truncate text-muted-foreground">
        {parts[0]}
      </span>
      <span className="min-w-0 truncate">{parts[1]}</span>
    </span>
  );
}
