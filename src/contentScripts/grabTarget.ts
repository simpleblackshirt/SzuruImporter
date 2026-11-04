/**
 * Context-menu target resolution for element grabs.
 *
 * Node identity is fragile on sites that re-render media around their own
 * context menus (e.g. x.com swaps the image node when its media menu opens
 * and closes): both Firefox's menus.getTargetElement and the stored
 * right-click element can point at a disconnected node by the time the menu
 * item is clicked, which used to bail the grab with "no-element" - silently,
 * before any engine logging. The media url survives re-renders (the
 * replacement node carries the same media id), so when node identity fails,
 * the target is revived from the menu's srcUrl.
 */

/** True when two urls share origin and path, ignoring rendition params. */
export function mediaUrlsMatch(a: string, b: string): boolean {
  try {
    const urlA = new URL(a);
    const urlB = new URL(b);
    return urlA.origin == urlB.origin && urlA.pathname == urlB.pathname;
  } catch {
    return false;
  }
}

/**
 * The connected element to grab: the candidate when it is still in the
 * document, otherwise a connected image matching the context menu's media
 * url (same origin + path, rendition params ignored). Only img elements are
 * considered - the engines' container resolution handles everything above
 * the media element, and other media kinds carry no stable url (blob videos)
 * or are skipped by design. undefined keeps the caller's bail behavior.
 */
export function resolveGrabTarget(
  candidate: Element | undefined,
  srcUrl: string | undefined,
  doc: Document,
): Element | undefined {
  if (candidate?.isConnected) {
    return candidate;
  }
  if (!srcUrl) {
    return undefined;
  }
  for (const img of Array.from(doc.querySelectorAll<HTMLImageElement>("img"))) {
    if (img.isConnected && img.src && mediaUrlsMatch(img.src, srcUrl)) {
      return img;
    }
  }
  return undefined;
}
