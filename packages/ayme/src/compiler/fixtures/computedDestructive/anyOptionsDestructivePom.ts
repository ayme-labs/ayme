import { ayme } from "@ayme-dev/ayme";

const options: any = { destructive: true };

@ayme
export class AnyOptionsDestructivePom {
  @ayme.action(options)
  submit() {}
}
