import { ayme } from "@ayme-dev/ayme";

@ayme
class Toolbar {
  @ayme.action
  save(): void {}
}

@ayme
export class SharedRootlessPom {
  first = new Toolbar();
  second = new Toolbar();
}
