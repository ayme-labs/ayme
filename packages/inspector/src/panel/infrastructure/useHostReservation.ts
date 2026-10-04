import { useCallback, useEffect, useRef } from "react";

import type { Dock, HostReservation } from "../domain/geometry";

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
 *
 * @returns sets the room to make, or none.
 */
export function useHostReservation() {
  const style = useRef<HTMLStyleElement>(undefined);
  const release = useCallback(() => {
    style.current?.remove();
    style.current = undefined;
  }, []);
  useEffect(() => release, [release]);

  return useCallback(
    (reservation: HostReservation | undefined) => {
      if (!reservation) return release();
      if (!style.current) {
        style.current = document.createElement("style");
        style.current.dataset.aymeInspectorDock = "";
        document.head.append(style.current);
      }
      style.current.textContent = `html { ${padding[reservation.dock]}: ${reservation.size}px !important; }`;
    },
    [release]
  );
}
