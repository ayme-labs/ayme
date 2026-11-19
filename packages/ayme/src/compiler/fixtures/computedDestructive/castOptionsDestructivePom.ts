import { ayme } from "@ayme-dev/ayme";

function flags(): object {
  return { destructive: true };
}

@ayme
export class CastOptionsDestructivePom {
  @ayme.action(flags() as any)
  submit() {}
}
