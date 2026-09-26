import { createContext, useContext, type ComponentProps } from "react";
import { Popover as PopoverPrimitive } from "radix-ui";

import { cn } from "@ayme-dev/design-system/lib/utils";

/**
 * The element Radix portals render into. Radix defaults to document.body,
 * which is outside the Inspector's shadow root: portalled content would lose
 * the shadow root's styles and leak into the host page. The Inspector renders
 * this element inside its themed root, so portals keep styles and dark mode.
 */
export const PortalContainerContext = createContext<HTMLElement | null>(null);

export function usePortalContainer() {
  return useContext(PortalContainerContext);
}

// Root, Trigger and Content come from one radix-ui import so they share one
// Popover context.
export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;

/**
 * The design system's PopoverContent, portalled into the Inspector's portal
 * container. The design system's own PopoverContent always portals into
 * document.body; it takes no container yet.
 */
export function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content>) {
  const container = usePortalContainer();
  return (
    <PopoverPrimitive.Portal container={container}>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-72 origin-(--radix-popover-content-transform-origin) rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-hidden data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          className
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
