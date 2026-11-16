import { version } from "../../../package.json";
import { PAIRING_CONTRACT } from "../../contract";

/**
 * Which Ayme a side of the pairing runs: its `@ayme-dev/mcp` version, which
 * `@ayme-dev/ayme` shares (the packages release with linked versions), and
 * the pairing contract it speaks. A page from before the contract was named
 * sends neither, and speaks the first one.
 */
export type AymeVersion = Readonly<{ version?: string; contract?: number }>;

/**
 * Why the page's Ayme and the server's can't work together, naming both
 * versions, or `undefined` when they can: they speak the same pairing
 * contract, whatever their versions. Short enough for a WebSocket close
 * reason (123 bytes) with versions of up to about 20 characters each.
 */
export function versionGap({
  page,
  server,
}: {
  page: AymeVersion;
  server: Required<AymeVersion>;
}): string | undefined {
  if ((page.contract ?? 1) === server.contract) return undefined;
  const onPage =
    page.version === undefined ? "An earlier Ayme" : `Ayme ${page.version}`;
  return `${onPage} on the page and the Ayme MCP server ${server.version} speak different pairing contracts.`;
}

/** This package's Ayme: its version and the pairing contract it speaks. */
export const OUR_AYME: Required<AymeVersion> = Object.freeze({
  version,
  contract: PAIRING_CONTRACT,
});
