/**
 * Context-menu target resolution for element grabs.
 *
 * Node identity is fragile on sites that re-render media around their own
 * context menus (e.g. x.com swaps the image node when its media menu opens,
 * and the native menu is only reachable on a SECOND right-click, whose target
 * is the site menu's overlay - not the image): both Firefox's
 * menus.getTargetElement and the stored right-click element can point at a
 * disconnected node by the time the menu item is clicked, which used to bail
 * the grab with "no-element" - silently, before any engine logging. The media
 * url survives re-renders (the replacement node carries the same media id),
 * so when node identity fails, the target is revived from the media url
 * tracked at right-click time (see mediaSrcFromTarget).
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
 * The media url of a right-clicked target: img src, video poster, otherwise
 * undefined. Used as the re-render-proof target handle; callers must NOT
 * clear the tracked value on non-media targets, so a second right-click on a
 * site menu overlay cannot erase the url of the image clicked before it.
 */
export function mediaSrcFromTarget(target: EventTarget | null): string | undefined {
  if (!(target instanceof Element)) {
    return undefined;
  }
  if (target.tagName == "IMG") {
    // getAttribute, not the src property: jsdom resolves a missing src to the
    // document url, and the raw attribute is the exact right-clicked value.
    return (target as HTMLImageElement).getAttribute("src") || undefined;
  }
  if (target.tagName == "VIDEO") {
    return (target as HTMLVideoElement).getAttribute("poster") || undefined;
  }
  return undefined;
}

/**
 * The connected element to grab: the candidate when it is still in the
 * document, otherwise a connected image matching the tracked media url (same
 * origin + path, rendition params ignored). Only img elements are considered
 * - the engines' container resolution handles everything above the media
 * element, and other media kinds carry no stable url (blob videos) or are
 * skipped by design. undefined keeps the caller's bail behavior.
 */
export function resolveGrabTarget(
  candidate: Element | undefined,
  mediaSrc: string | undefined,
  doc: Document,
): Element | undefined {
  if (candidate?.isConnected) {
    return candidate;
  }
  if (!mediaSrc) {
    return undefined;
  }
  for (const img of Array.from(doc.querySelectorAll<HTMLImageElement>("img"))) {
    if (img.isConnected && img.src && mediaUrlsMatch(img.src, mediaSrc)) {
      return img;
    }
  }
  return undefined;
}
