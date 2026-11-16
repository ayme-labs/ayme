import { ayme } from "@ayme-dev/ayme";

@ayme
export class Scheduler {
  @ayme.action({ description: "Schedule at a time." })
  schedule(at: Date) {
    void at;
  }
}
