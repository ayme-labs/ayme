import type { Command } from "./readCommand";

/** What the command line does for a command it has read. */
export type Plan =
  | {
      kind: "print";
      stream: "stdout" | "stderr";
      text: string;
      exitCode: number;
    }
  | {
      kind: "codegen";
      target:
        | { url: string; headless: boolean | undefined }
        | { cdpEndpoint: string };
    }
  | { kind: "install"; args: string[] }
  | { kind: "trace"; args: string[] };

/**
 * Decides what to do for a command: print and stop, or run one of the four
 * things the command line runs. `cli.ts` only carries the plan out.
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
    case "error":
      return {
        kind: "print",
        stream: "stderr",
        text: command.text,
        exitCode: 1,
      };
    case "attach":
      return { kind: "codegen", target: { cdpEndpoint: command.cdpEndpoint } };
    case "codegen":
      return {
        kind: "codegen",
        target: { url: command.url, headless: command.headless },
      };
    case "install":
      return { kind: "install", args: command.args };
    case "trace":
      return { kind: "trace", args: command.args };
  }
}
