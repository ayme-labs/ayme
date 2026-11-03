import { ayme } from "@ayme-dev/ayme";

@ayme
export class AnyPom {
  @ayme.child
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly part!: any;
}
