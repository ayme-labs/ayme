"use client";

import * as React from "react";

/*
 * Where portalled content, such as a popover's, mounts. Radix portals into
 * `document.body` by default, which is outside a shadow root and so outside
 * its styles. A panel in a shadow root provides an element inside that root:
 * usually its own root element, so the content also picks up its `.dark` class.
 */
const PortalContainerContext = React.createContext<HTMLElement | null>(null);

export const PortalContainerProvider = PortalContainerContext.Provider;

export function usePortalContainer(): HTMLElement | null {
  return React.useContext(PortalContainerContext);
}
