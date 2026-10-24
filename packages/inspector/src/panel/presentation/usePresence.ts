import { useLayoutEffect, useRef, useState } from "react";

import { cn } from "@ayme-dev/design-system/lib/utils";

// Stryker disable StringLiteral: Tailwind classes are styling, which no test reads.

// Entering, the element fades in and grows from 0.9 on the spring; leaving,
// it goes back the same way. With reduced motion it only fades in, and
// leaves at once.
const motion =
  "transition-[opacity,scale] duration-(--duration-spring) ease-(--ease-spring) data-[state=closed]:opacity-0 motion-safe:data-[state=closed]:scale-90 motion-reduce:data-[state=closed]:transition-none";
const entrance = "starting:opacity-0 motion-safe:starting:scale-90";

// Stryker restore StringLiteral

/**
 * An element that enters and leaves on the spring, such as the panel and
 * its logo. Shown, it mounts at once; hidden, it stays mounted, closed, until
 * the transitions closing started have finished. Shown again before then,
 * they turn around from where they are. It enters with motion only when
 * `entering`: when the person opened it, not when the page loads.
 */
export function usePresence<T extends Element>(
  shown: boolean,
  entering: boolean
) {
  const ref = useRef<T>(null);
  const [mounted, setMounted] = useState(shown);
  if (shown && !mounted) setMounted(true);

  useLayoutEffect(() => {
    const element = ref.current;
    if (shown || !element) return;
    let hidden = true;
    // A transition can be cancelled on the way, by the theme switch's say;
    // whatever runs then is waited for again. None at all, it unmounts now.
    const leave = async () => {
      for (
        let running = element.getAnimations();
        running.length > 0;
        running = element.getAnimations()
      ) {
        await Promise.allSettled(running.map(({ finished }) => finished));
        // Stryker disable next-line ConditionalExpression: a leave that goes on after the element is shown again unmounts nothing, since a shown element mounts again in the same render.
        if (!hidden) return;
      }
      setMounted(false);
    };
    void leave();
    // Stryker disable BlockStatement,BooleanLiteral: as above, a leave that goes on after the element is shown again unmounts nothing.
    return () => {
      hidden = false;
    };
    // Stryker restore BlockStatement,BooleanLiteral
  }, [shown]);

  return {
    ref,
    mounted: shown || mounted,
    state: shown ? ("open" as const) : ("closed" as const),
    className: cn(motion, entering && entrance),
  };
}

export type Presence<T extends Element> = ReturnType<typeof usePresence<T>>;
