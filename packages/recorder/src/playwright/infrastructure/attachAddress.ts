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
  // A hostname holds brackets only around a whole IPv6 address, so the
  // anchors change nothing.
  // Stryker disable next-line Regex
  const unbracketed = /^\[|\]$/g;
  const host = url.hostname.replace(unbracketed, "").toLowerCase();
  if (host === "localhost" || host === "::1") return true;
  return isIPv4(host) && host.split(".")[0] === "127";
}

/** Why an address is not one the recorder attaches to, as a sentence. */
export const attachAddressRule = (address: string) =>
  `The recorder attaches only to a browser on this machine, at an http:// or ws:// address on localhost or 127.0.0.1, such as http://127.0.0.1:9222. It was given ${address}.`;

/** Why a browser with this many pages open is not one the recorder attaches
 * to, as a sentence: it records the one page open, and leaves it as it is. */
export function notOnePageMessage(pages: number): string {
  const found = pages === 0 ? "no page" : `${pages} pages`;
  const todo = pages === 0 ? "open the page to record" : "close the others";
  return `The recorder records a browser with exactly one page open, and leaves it as it is. The browser at this address has ${found} open: ${todo} and attach again.`;
}
