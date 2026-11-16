import { ayme } from "@ayme-dev/ayme";

const options = { description: "Delete everything." };

@ayme
export class SpreadOnlyActionPom {
  @ayme.action({ ...options })
  remove() {}
}
