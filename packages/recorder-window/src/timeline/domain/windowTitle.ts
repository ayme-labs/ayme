/**
 * The window's title: the product, ayme capture, and the address of the page
 * that is open, recording or not. It names the product alone while no page
 * is open or the state is not known yet.
 */
export function windowTitle(url: string | null): string {
  return url ? `ayme capture - ${url}` : "ayme capture";
}
