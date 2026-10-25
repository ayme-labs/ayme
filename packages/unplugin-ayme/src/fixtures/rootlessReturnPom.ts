import { ayme } from "@ayme-dev/ayme";

@ayme
class Toolbar {}

@ayme
export class RootlessReturnPom {
  toolbar = new Toolbar();

  @ayme.action
  open(): Toolbar {
    return this.toolbar;
  }

  @ayme.action
  reopen(): Toolbar {
    return this.toolbar;
  }
}
