import { WebMCP } from "@ayme-dev/webmcp";

@WebMCP({ description: "A page that opens related POMs." })
export class ReturningPom {
  @WebMCP.tool({ description: "Open a related POM." })
  async open(): Promise<FirstReturnPom | Promise<SecondReturnPom> | string> {
    return new FirstReturnPom();
  }

  @WebMCP.tool({})
  status() {}
}

@WebMCP({ description: "The first returned POM." })
export class FirstReturnPom {
  @WebMCP.tool({ description: "Use the first returned POM." })
  use() {}
}

@WebMCP
export class SecondReturnPom {}
