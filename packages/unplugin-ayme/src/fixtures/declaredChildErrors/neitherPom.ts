import { ayme } from "@ayme-dev/ayme";

@ayme
export class NeitherPom {
  @ayme.child
  readonly title!: string;
}
