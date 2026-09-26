import { useEffect, useRef } from "react";

import type { Dock } from "./geometry";

export type HostReservation = { dock: Dock; size: number };

const padding: Record<Dock, string> = {
  left: "padding-left",
  right: "padding-right",
  bottom: "padding-bottom",
};

/**
 * While the panel is docked, the host page makes room for it: a style in the
 * host document pads the page's root on the docked side, so the panel sits
 * beside the page instead of over it. The style is the only change to the
 * host, it belongs to this panel alone, and it's removed as soon as the
 * panel floats, collapses or unmounts.
 */
export function useHostReservation(reservation: HostReservation | undefined) {
  const style = useRef<HTMLStyleElement>(undefined);
  const active = reservation !== undefined;

  useEffect(() => {
    if (!active) return;
    const element = document.createElement("style");
    element.dataset.aymeInspectorDock = "";
    document.head.append(element);
    style.current = element;
    return () => {
      element.remove();
      style.current = undefined;
    };
  }, [active]);

  const rule = reservation
    ? `html { ${padding[reservation.dock]}: ${reservation.size}px !important; }`
    : "";
  useEffect(() => {
    if (style.current) style.current.textContent = rule;
  }, [rule, active]);
}
