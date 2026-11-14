import { Circle, Play, Square } from "lucide-react";

import type { Controls } from "../domain/controls";

type PrimaryType = NonNullable<Controls["primary"]>["command"]["type"];

/** The icon of the control that records, stops or continues. */
export const PRIMARY_ICONS = {
  record: Circle,
  stop: Square,
  continue: Play,
} satisfies Record<PrimaryType, unknown>;

/** Record's icon is red; Stop's and Continue's take the text's colour. */
export const PRIMARY_ICON_CLASSES = {
  record: "fill-red-500 text-red-500",
  stop: "fill-current",
  continue: "fill-current",
} satisfies Record<PrimaryType, string>;
