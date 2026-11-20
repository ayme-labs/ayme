/**
 * The window's title: the recorder, and the address of the page that is
 * open, recording or not. It names the recorder alone while no page is open
 * or the state is not known yet.
 */
export function windowTitle(url: string | null): string {
  return url ? `Ayme Recorder - ${url}` : "Ayme Recorder";
}
