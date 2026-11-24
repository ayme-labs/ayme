import { Circle, Square } from "lucide-react";

import type { Controls } from "../domain/controls";

type PrimaryType = NonNullable<Controls["primary"]>["command"]["type"];

/** The icon of the control that records, stops or continues: a dot to
 * record or go on recording, a square to stop. */
export const PRIMARY_ICONS = {
  record: Circle,
  stop: Square,
  continue: Circle,
} satisfies Record<PrimaryType, unknown>;
