import { ayme } from "@ayme-dev/ayme";

@ayme
class Toolbar {
  @ayme.action
  save(): void {}
}

@ayme
export class SharedRootlessPom {
  @ayme.child
  first = new Toolbar();
  @ayme.child
  second = new Toolbar();
}
