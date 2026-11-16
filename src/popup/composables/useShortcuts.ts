import type { Ref } from "vue";
import { isTextEntryTarget, shouldIgnoreShortcut } from "~/utils/keyboard";

/**
 * Shared window keydown handling for the popup and merge pages: the
 * upload/merge shortcut, the plain single-key shortcuts, and the cheat-sheet
 * layer. Page-specific actions are optional, so each page binds only what it
 * has. Plain keys never fire while typing: the isTextEntryTarget guard keeps
 * every text field's keystrokes untouched. The Ctrl-modified variants of the
 * single-key actions do fire while typing, so acting on the post never
 * requires leaving a text field.
 */
export interface ShortcutActions {
  /** Ctrl+Enter - upload the selected post / merge changes. */
  primary(): void;
  /** Ctrl+Shift+Enter - upload and advance to the next grabbed post (popup only). */
  primaryAdvance?: () => void;
  /** s / Ctrl+S - cycle the safety rating. */
  cycleSafety(): void;
  /** , / . / Ctrl+, / Ctrl+. - previous / next grabbed post (popup only). */
  previousPost?: () => void;
  nextPost?: () => void;
  /** k / Ctrl+K - toggle "keep tags between posts" (popup only). */
  toggleKeepTags?: () => void;
  /** m / Ctrl+M - enter merge mode for the exact/similar post (popup only). */
  merge?: () => void;
  /** i / Ctrl+I - toggle which image to keep on the merge page (merge only). */
  toggleImage?: () => void;
  /** / - drop the caret into the tag input. */
  focusTagInput(): void;
}

export function useKeyboardShortcuts(actions: ShortcutActions, cheatsheetOpen: Ref<boolean>) {
  function onKeydown(e: KeyboardEvent) {
    // Ctrl+Enter (Cmd+Enter on Mac) uploads / merges - same as the button.
    // Ctrl+Shift+Enter additionally advances to the next grabbed post. The
    // uploading guards in the page actions prevent re-entry.
    if ((e.ctrlKey || e.metaKey) && e.key == "Enter") {
      e.preventDefault();
      if (e.shiftKey && actions.primaryAdvance) {
        actions.primaryAdvance();
      } else {
        actions.primary();
      }
      return;
    }

    // Escape is never intercepted: it natively dismisses the popup on both
    // engines (Firefox does not deliver Escape to extension popups at all,
    // bugzilla 1443758). No Escape handling lives here on purpose.

    // Ctrl+H toggles the cheat sheet from anywhere - including text fields
    // and while the sheet itself is open (it doubles as the close key).
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.isComposing && e.key.toLowerCase() == "h") {
      e.preventDefault();
      cheatsheetOpen.value = !cheatsheetOpen.value;
      return;
    }

    // "?" toggles the cheat sheet - but only outside text fields, where it
    // must keep typing a question mark.
    if (e.key == "?" && !isTextEntryTarget(e)) {
      e.preventDefault();
      cheatsheetOpen.value = !cheatsheetOpen.value;
      return;
    }

    // While the sheet is open it is modal: no further shortcut handling.
    if (cheatsheetOpen.value) return;

    // Ctrl-modified variants of the single-key actions work while a text
    // field has focus, so acting on a post never requires leaving the tag
    // input. Plain-key variants below stay for non-text focus. Only combos
    // the page actually bound are consumed - everything else (Ctrl+C,
    // Ctrl+V, select-all, ...) keeps its native behavior.
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.isComposing) {
      const ctrlActions: Record<string, (() => void) | undefined> = {
        s: () => actions.cycleSafety(),
        ",": actions.previousPost,
        ".": actions.nextPost,
        k: actions.toggleKeepTags,
        m: actions.merge,
        i: actions.toggleImage,
      };
      const ctrlAction = ctrlActions[e.key.toLowerCase()];
      if (ctrlAction) {
        e.preventDefault();
        ctrlAction();
        return;
      }
    }

    if (shouldIgnoreShortcut(e) || isTextEntryTarget(e)) return;

    // Plain single-key shortcuts. The guards above ensure typing in any
    // field is untouched: only a non-text focus reaches this switch.
    switch (e.key.toLowerCase()) {
      case "s":
        e.preventDefault();
        actions.cycleSafety();
        break;
      case ",":
        e.preventDefault();
        actions.previousPost?.();
        break;
      case ".":
        e.preventDefault();
        actions.nextPost?.();
        break;
      case "k":
        e.preventDefault();
        actions.toggleKeepTags?.();
        break;
      case "m":
        e.preventDefault();
        actions.merge?.();
        break;
      case "i":
        e.preventDefault();
        actions.toggleImage?.();
        break;
      case "/":
        e.preventDefault();
        actions.focusTagInput();
        break;
    }
  }

  onMounted(() => window.addEventListener("keydown", onKeydown));
  onUnmounted(() => window.removeEventListener("keydown", onKeydown));
}
