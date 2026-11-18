import { ayme } from "@ayme-dev/ayme";

@ayme
export class ParenthesizedOptionsPom {
  // prettier-ignore
  @ayme.action(({ description: "Submit the order.", destructive: true }))
  submit() {}
}
