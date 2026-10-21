import { cn } from "@ayme-dev/design-system/lib/utils";

/**
 * Whether something is on the page now: a filled dot when it is, a hollow
 * ring when it isn't. The legend uses the same two marks.
 */
export function LiveMark({ live }: { live: boolean }) {
  return (
    <span
      className={cn(
        "size-2 flex-none rounded-full",
        live
          ? "bg-success"
          : "shadow-[inset_0_0_0_1.5px_var(--color-muted-foreground)]"
      )}
      title={live ? "On this page" : "Not on page"}
      aria-hidden
    />
  );
}
