import { ayme } from "@ayme-dev/ayme";

declare const options: { destructive: boolean } | { available: () => boolean };

@ayme
export class UnionSpreadDestructivePom {
  @ayme.action({ ...options })
  submit() {}
}
