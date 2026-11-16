import { ayme } from "@ayme-dev/ayme";

declare const key: string;

@ayme
export class ComputedKeyActionPom {
  @ayme.action({ description: "Read only.", [key]: "Delete everything." })
  read() {}
}
