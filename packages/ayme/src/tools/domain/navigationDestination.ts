import { ToolInputError } from "../../shared";

/**
 * Package-internal: where `navigate` opens `url`, resolved against the
 * document's `baseURI`; `undefined` when `url` is no URL. Throws
 * `ToolInputError` for a protocol other than http(s), and for a URL off the
 * page's own `origin`.
 */
export function navigationDestination(
  url: string,
  baseURI: string,
  origin: string
): URL | undefined {
  const destination = URL.parse(url, baseURI);
  if (!destination) return undefined;
  // Only http(s) documents run this runtime; a same-origin blob: URL
  // would pass the origin check below.
  if (!["http:", "https:"].includes(destination.protocol))
    throw new ToolInputError(
      `Cannot navigate to "${url}": the protocol ${destination.protocol} is not supported.`
    );
  if (destination.origin !== origin)
    throw new ToolInputError(
      `Cannot navigate to "${url}": it is not on the page's own origin, ${origin}. Leaving the origin would lose the connection to this page.`
    );
  return destination;
}
