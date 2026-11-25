import { useLayoutEffect, useRef, useState } from "react";

import { cn } from "@ayme-dev/design-system/lib/utils";

// Stryker disable StringLiteral: Tailwind classes are styling, which no test reads.

// Closed, the element is faded out and, with motion, at 0.9 of its size.
const closed =
  "data-[state=closed]:opacity-0 motion-safe:data-[state=closed]:scale-90";
// Moving, it enters from there and leaves for there on the spring. With
// reduced motion it only fades in, and leaves at once.
const motion =
  "transition-[opacity,scale] duration-(--duration-spring) ease-(--ease-spring) starting:opacity-0 motion-safe:starting:scale-90 motion-reduce:data-[state=closed]:transition-none";

// Stryker restore StringLiteral

/**
 * An element that enters and leaves on the spring, such as the panel and
 * its logo. Shown, it mounts at once; hidden, it stays mounted, closed, until
 * the transitions closing started have finished. Shown again before then,
 * they turn around from where they are. It moves only when `moving`: when
 * the person opened or closed it with a pointer. A key or a screen reader
 * shows and hides it at once, as the page shows it at once when it loads.
 */
export function usePresence<T extends Element>(
  shown: boolean,
  moving: boolean
) {
  const ref = useRef<T>(null);
  const [mounted, setMounted] = useState(shown);
  if (shown && !mounted) setMounted(true);

  useLayoutEffect(() => {
    const element = ref.current;
    if (shown || !element) return;
    // It waits until nothing moves it, a glide included; a transition
    // cancelled on the way only ends one wait. None at all, it unmounts now.
    // Shown again meanwhile, it unmounts nothing: a shown element mounts
    // again in the same render.
    const leave = async () => {
      for (
        let running = element.getAnimations();
        running.length > 0;
        running = element.getAnimations()
      )
        await Promise.allSettled(running.map(({ finished }) => finished));
      setMounted(false);
    };
    void leave();
  }, [shown]);

  /** Ends its entrance at once, where it was going. Only while it's there. */
  const finish = () => {
    for (const animation of ref.current!.getAnimations())
      if (animation instanceof CSSTransition) animation.finish();
  };

  return {
    ref,
    mounted: shown || mounted,
    state: shown ? ("open" as const) : ("closed" as const),
    className: cn(closed, moving && motion),
    finish,
  };
}

export type Presence<T extends Element> = ReturnType<typeof usePresence<T>>;
