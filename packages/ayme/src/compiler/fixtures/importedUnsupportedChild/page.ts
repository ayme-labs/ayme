import { ayme } from "@ayme-dev/ayme";

import { Scheduler } from "./child";

@ayme
export class CalendarPage {
  @ayme.child
  scheduler!: Scheduler;
}
