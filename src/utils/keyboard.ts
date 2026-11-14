/**
 * Pure helpers for the popup's keyboard workflow: guard checks for global
 * single-key shortcuts, and index math for the autocomplete dropdown. Kept
 * free of component wiring so the behavior is directly unit-testable.
 */

/** True when the event target is a text-entry element; single-key shortcuts must not fire there. */
export function isTextEntryTarget(e: KeyboardEvent): boolean {
  const el = e.target;
  if (!(el instanceof HTMLElement)) return false;
  // The attribute check supplements isContentEditable, which some DOM
  // implementations (jsdom) do not expose.
  return (
    el.tagName == "INPUT" ||
    el.tagName == "TEXTAREA" ||
    el.tagName == "SELECT" ||
    el.isContentEditable === true ||
    el.getAttribute("contenteditable") == "true"
  );
}

/**
 * True when a plain-key shortcut must be ignored: an IME composition is in
 * progress, or the chord involves Ctrl/Meta/Alt (browser and extension
 * shortcuts stay untouched; Shift is allowed for "?" and uppercase letters).
 */
export function shouldIgnoreShortcut(e: KeyboardEvent): boolean {
  return e.isComposing || e.ctrlKey || e.metaKey || e.altKey;
}

const SAFETY_ORDER = ["safe", "sketchy", "unsafe"];

/** Cycles the post rating safe -> sketchy -> unsafe -> safe. Unknown values wrap to "safe". */
export function cycleSafety(current: string): string {
  const idx = SAFETY_ORDER.indexOf(current);
  return SAFETY_ORDER[(idx + 1) % SAFETY_ORDER.length];
}

/** Id of the post one step away from currentId; undefined at the ends or when currentId is not in the list. */
export function neighborPostId(
  posts: Array<{ id: string }>,
  currentId: string | undefined,
  delta: -1 | 1,
): string | undefined {
  const idx = posts.findIndex((x) => x.id == currentId);
  if (idx == -1) return undefined;
  return posts[idx + delta]?.id;
}

/** How many rows PageUp/PageDown jump in the autocomplete dropdown. */
const AUTOCOMPLETE_PAGE_STEP = 5;

/**
 * New highlighted index for autocomplete navigation keys, clamped to
 * [-1, count - 1] (-1 = nothing highlighted, the pre-existing arrow behavior).
 * Returns undefined for keys that are not navigation, and for an empty list -
 * callers leave such events to the browser.
 */
export function nextAutocompleteIndex(code: string, index: number, count: number): number | undefined {
  if (count == 0) return undefined;
  switch (code) {
    case "ArrowDown":
      return Math.min(index + 1, count - 1);
    case "ArrowUp":
      return Math.max(index, 0) - 1;
    case "PageDown":
      return Math.min(index + AUTOCOMPLETE_PAGE_STEP, count - 1);
    case "PageUp":
      return Math.max(index - AUTOCOMPLETE_PAGE_STEP, -1);
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return undefined;
  }
}
