import { version } from "../package.json";
import type { CaptureTarget, Command } from "./readCommand";

/** What the command line does for a command it has read. */
export type Plan =
  | {
      kind: "print";
      stream: "stdout" | "stderr";
      text: string;
      exitCode: number;
    }
  | { kind: "capture"; target: CaptureTarget }
  | Extract<
      Command,
      {
        kind:
          | "open"
          | "attach"
          | "ask"
          | "call"
          | "inspect"
          | "mcp"
          | "list"
          | "session process";
      }
    >;

/**
 * Decides what to do for a command: print and stop, record with
 * `ayme capture`, or reach a Session, `ayme mcp` included. `cli.ts` only carries the plan out.
 */
export function planOf(command: Command): Plan {
  switch (command.kind) {
    case "help":
      return {
        kind: "print",
        stream: "stdout",
        text: command.text,
        exitCode: 0,
      };
    case "version":
      return {
        kind: "print",
        stream: "stdout",
        text: `${version}\n`,
        exitCode: 0,
      };
    case "error":
      return {
        kind: "print",
        stream: "stderr",
        text: command.text,
        exitCode: 1,
      };
    case "capture":
      return { kind: "capture", target: command.target };
    case "open":
    case "attach":
    case "ask":
    case "call":
    case "inspect":
    case "mcp":
    case "list":
    case "session process":
      return command;
  }
}
