import type { Ref } from "vue";
import { isTextEntryTarget, shouldIgnoreShortcut } from "~/utils/keyboard";

/**
 * Shared window keydown handling for the popup and merge pages: the
 * upload/merge shortcut, the plain single-key shortcuts, and the cheat-sheet
 * layer. Page-specific actions are optional, so each page binds only what it
 * has. Plain keys never fire while typing: the isTextEntryTarget guard keeps
 * every text field's keystrokes untouched.
 */
export interface ShortcutActions {
  /** Ctrl+Enter - upload the selected post / merge changes. */
  primary(): void;
  /** Ctrl+Shift+Enter - upload and advance to the next grabbed post (popup only). */
  primaryAdvance?: () => void;
  /** s - cycle the safety rating. */
  cycleSafety(): void;
  /** , / . - previous / next grabbed post (popup only). */
  previousPost?: () => void;
  nextPost?: () => void;
  /** k - toggle "keep tags between posts" (popup only). */
  toggleKeepTags?: () => void;
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

    // The cheat sheet is the topmost layer: Escape closes it from anywhere,
    // before the dropdown/card/popup layers get a chance.
    if (cheatsheetOpen.value && e.key == "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cheatsheetOpen.value = false;
      return;
    }

    // "?" toggles the cheat sheet - but only outside text fields, where it
    // must keep typing a question mark.
    if (e.key == "?" && !isTextEntryTarget(e)) {
      e.preventDefault();
      cheatsheetOpen.value = !cheatsheetOpen.value;
      return;
    }

    // While the sheet is open it is modal: no further plain-key handling.
    if (cheatsheetOpen.value) return;

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
      case "/":
        e.preventDefault();
        actions.focusTagInput();
        break;
    }
  }

  onMounted(() => window.addEventListener("keydown", onKeydown));
  onUnmounted(() => window.removeEventListener("keydown", onKeydown));
}
