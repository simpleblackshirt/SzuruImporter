import { describe, expect, it } from "vitest";
import {
  cycleSafety,
  isTextEntryTarget,
  neighborPostId,
  nextAutocompleteIndex,
  shouldIgnoreShortcut,
} from "./keyboard";

/** KeyboardEvent with an overridable target - jsdom events default to the constructing window. */
function keyEvent(init: KeyboardEventInit & { target?: EventTarget | null } = {}): KeyboardEvent {
  const e = new KeyboardEvent("keydown", init);
  if (init.target !== undefined) {
    Object.defineProperty(e, "target", { value: init.target });
  }
  return e;
}

describe("isTextEntryTarget", () => {
  it("should be true for inputs, textareas and selects", () => {
    for (const tag of ["input", "textarea", "select"]) {
      const el = document.createElement(tag);
      expect(isTextEntryTarget(keyEvent({ target: el })), tag).toBe(true);
    }
  });

  it("should be true for contenteditable elements", () => {
    const el = document.createElement("div");
    el.setAttribute("contenteditable", "true");
    expect(isTextEntryTarget(keyEvent({ target: el }))).toBe(true);
  });

  it("should be false for other elements and a missing target", () => {
    expect(isTextEntryTarget(keyEvent({ target: document.createElement("div") }))).toBe(false);
    expect(isTextEntryTarget(keyEvent({ target: document.body }))).toBe(false);
    expect(isTextEntryTarget(keyEvent({ target: null }))).toBe(false);
  });
});

describe("shouldIgnoreShortcut", () => {
  it("should ignore IME composition", () => {
    expect(shouldIgnoreShortcut(keyEvent({ isComposing: true }))).toBe(true);
  });

  it("should ignore chords with ctrl, meta or alt", () => {
    expect(shouldIgnoreShortcut(keyEvent({ ctrlKey: true }))).toBe(true);
    expect(shouldIgnoreShortcut(keyEvent({ metaKey: true }))).toBe(true);
    expect(shouldIgnoreShortcut(keyEvent({ altKey: true }))).toBe(true);
  });

  it("should allow plain keys and shift (for ? and uppercase letters)", () => {
    expect(shouldIgnoreShortcut(keyEvent({ key: "s" }))).toBe(false);
    expect(shouldIgnoreShortcut(keyEvent({ key: "S", shiftKey: true }))).toBe(false);
  });
});

describe("cycleSafety", () => {
  it("should cycle safe -> sketchy -> unsafe -> safe", () => {
    expect(cycleSafety("safe")).toBe("sketchy");
    expect(cycleSafety("sketchy")).toBe("unsafe");
    expect(cycleSafety("unsafe")).toBe("safe");
  });

  it("should wrap unknown values to safe", () => {
    expect(cycleSafety("")).toBe("safe");
    expect(cycleSafety("unknown")).toBe("safe");
  });
});

describe("neighborPostId", () => {
  const posts = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("should return the adjacent id", () => {
    expect(neighborPostId(posts, "b", -1)).toBe("a");
    expect(neighborPostId(posts, "b", 1)).toBe("c");
  });

  it("should return undefined at the ends", () => {
    expect(neighborPostId(posts, "a", -1)).toBeUndefined();
    expect(neighborPostId(posts, "c", 1)).toBeUndefined();
  });

  it("should return undefined for an unknown current id or empty list", () => {
    expect(neighborPostId(posts, "missing", 1)).toBeUndefined();
    expect(neighborPostId(posts, undefined, 1)).toBeUndefined();
    expect(neighborPostId([], "a", 1)).toBeUndefined();
  });
});

describe("nextAutocompleteIndex", () => {
  it("should step with the arrow keys and clamp at the ends", () => {
    expect(nextAutocompleteIndex("ArrowDown", -1, 3)).toBe(0);
    expect(nextAutocompleteIndex("ArrowDown", 2, 3)).toBe(2);
    expect(nextAutocompleteIndex("ArrowUp", -1, 3)).toBe(-1);
    expect(nextAutocompleteIndex("ArrowUp", 0, 3)).toBe(-1);
    expect(nextAutocompleteIndex("ArrowUp", 2, 3)).toBe(1);
  });

  it("should jump five rows per page key", () => {
    expect(nextAutocompleteIndex("PageDown", -1, 100)).toBe(4);
    expect(nextAutocompleteIndex("PageDown", 4, 100)).toBe(9);
    expect(nextAutocompleteIndex("PageUp", 9, 100)).toBe(4);
    expect(nextAutocompleteIndex("PageUp", 4, 100)).toBe(-1);
    // Clamped on short lists.
    expect(nextAutocompleteIndex("PageDown", -1, 3)).toBe(2);
  });

  it("should jump to the ends with Home and End", () => {
    expect(nextAutocompleteIndex("Home", 42, 100)).toBe(0);
    expect(nextAutocompleteIndex("End", -1, 100)).toBe(99);
  });

  it("should leave other keys and empty lists alone", () => {
    expect(nextAutocompleteIndex("Enter", 0, 3)).toBeUndefined();
    expect(nextAutocompleteIndex("ArrowDown", -1, 0)).toBeUndefined();
  });
});
