// The in-page module's reach for the host that runs in the document's own
// realm, the browser runtime, which holds the elements it measures. Node
// hosts send refs through `inPage(page).measureReach` instead.
import { installInPage } from "virtual:ayme-in-page";

import { version } from "../../../package.json";
import { InPageVersionError } from "./inPage";
import type { Reach, Slot } from "../page/install";

export type { Reach };

/**
 * The reach of this realm's document, installing its module when it has
 * none. The runtime is the realm's own host, so it needs no binding to be
 * called back through.
 */
export function reachInRealm(): Reach {
  const slotOf = () =>
    (globalThis as { [key: symbol]: Slot | undefined })[
      Symbol.for("ayme.inPage")
    ];
  if (slotOf()?.version === version) return slotOf()!.reach;
  const result = installInPage({
    version,
    host: "realm",
    binding: "",
  });
  if (result.kind === "version")
    throw new InPageVersionError(
      `This document runs Ayme's in-page module ${result.found}; this host is ${version}.`
    );
  return slotOf()!.reach;
}
