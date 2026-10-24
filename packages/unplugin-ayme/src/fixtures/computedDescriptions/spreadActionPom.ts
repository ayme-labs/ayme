import { ayme } from "@ayme-dev/ayme";

const options: { description?: string } = { description: "Delete everything." };

@ayme
export class SpreadActionPom {
  @ayme.action({
    description: "Read only.",
    ...options,
  })
  read() {}
}
