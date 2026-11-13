import { isIPv4 } from "node:net";

/**
 * Whether the recorder attaches to a browser at this address: one of the
 * DevTools protocol (http:// or ws://) on this machine, by `localhost` or a
 * loopback address, as the released recorder accepts. A browser elsewhere
 * would have the recorder drive input on another machine.
 */
export function isAttachAddress(address: string): boolean {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "ws:") return false;
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host === "::1") return true;
  return isIPv4(host) && host.split(".")[0] === "127";
}

/** Why an address is not one the recorder attaches to, as a sentence. */
export const attachAddressRule = (address: string) =>
  `The recorder attaches only to a browser on this machine, at an http:// or ws:// address on localhost or 127.0.0.1, such as http://127.0.0.1:9222. It was given ${address}.`;
