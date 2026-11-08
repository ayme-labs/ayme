import { ayme } from "@ayme-dev/ayme";

@ayme({ description: "A page that opens related POMs." })
export class ReturningPom {
  @ayme.action({ description: "Open a related POM." })
  async open(): Promise<FirstReturnPom | Promise<SecondReturnPom> | string> {
    return new FirstReturnPom();
  }

  @ayme.action
  status() {}
}

@ayme({ description: "The first returned POM." })
export class FirstReturnPom {
  @ayme.action({ description: "Use the first returned POM." })
  use() {}
}

@ayme
export class SecondReturnPom {}
