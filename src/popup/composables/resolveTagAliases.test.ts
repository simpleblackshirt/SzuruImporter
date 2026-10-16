import { describe, expect, it } from "vitest";
import type { Tag } from "~/api/models";
import { TagDetails } from "~/models";
import { resolveTagAliases } from "./resolveTagAliases";

// Minimal instance tag: resolveTagAliases only reads names[] (primary first).
function instanceTag(...names: string[]): Tag {
  return { names, category: "default", usages: 1 } as unknown as Tag;
}

describe("resolveTagAliases", () => {
  it("rewrites a scraped alias to the instance tag's primary name", () => {
    // Failure mode caught: alias left in the payload, uploading a name the
    // instance only knows as an alias instead of its primary name.
    const scraped = new TagDetails(["alias"]);

    const result = resolveTagAliases([scraped], [instanceTag("primary", "alias")]);

    expect(result.map((t) => t.name)).toEqual(["primary"]);
    expect(result[0].names).toEqual(["primary"]);
    // Kept metadata travels over to the rewritten tag.
    expect(result[0].category).toBeUndefined();
  });

  it("rewrites a scraped alias to the primary name without mutating the input tag", () => {
    // Failure mode caught: in-place mutation leaking the rewrite into state the
    // caller did not ask to update (the function must be pure).
    const scraped = new TagDetails(["alias"], "character");

    const result = resolveTagAliases([scraped], [instanceTag("primary", "alias")]);

    expect(scraped.name).toBe("alias");
    expect(result[0].name).toBe("primary");
    expect(result[0].category).toBe("character");
  });

  it("keeps the same tag object for a scraped name that is already primary", () => {
    // Failure mode caught: needless re-allocation breaking object identity the
    // popup may hold on to.
    const scraped = new TagDetails(["primary"], "artist");

    const result = resolveTagAliases([scraped], [instanceTag("primary", "alias")]);

    expect(result).toEqual([scraped]);
    expect(result[0]).toBe(scraped);
  });

  it("leaves tags unknown to the instance unchanged", () => {
    // Failure mode caught: unknown tags being dropped or renamed.
    const a = new TagDetails(["unknown-a"]);
    const b = new TagDetails(["unknown-b"], "copyright");

    const result = resolveTagAliases([a, b], [instanceTag("primary", "alias")]);

    expect(result).toEqual([a, b]);
    expect(result[0]).toBe(a);
    expect(result[1]).toBe(b);
  });

  it("collapses alias and primary duplicates into the first occurrence's position", () => {
    // Failure mode caught: duplicate tag names after alias-to-primary
    // collapsing (source provided both the alias and the primary).
    const alias = new TagDetails(["alias"]);
    const other = new TagDetails(["other"]);
    const primary = new TagDetails(["primary"]);

    const result = resolveTagAliases([alias, other, primary], [instanceTag("primary", "alias")]);

    expect(result.map((t) => t.name)).toEqual(["primary", "other"]);
  });

  it("prefers a duplicate occurrence with a category over one without", () => {
    // Failure mode caught: the collapsed tag losing its category because the
    // uncategorized first occurrence won unconditionally.
    const bare = new TagDetails(["alias"]);
    const categorized = new TagDetails(["primary"], "artist");

    const result = resolveTagAliases([bare, categorized], [instanceTag("primary", "alias")]);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("primary");
    expect(result[0].category).toBe("artist");
  });

  it("keeps the first occurrence when several duplicates have categories", () => {
    // Failure mode caught: last-one-wins overwriting an already-categorized tag.
    const first = new TagDetails(["alias"], "artist");
    const second = new TagDetails(["primary"], "character");

    const result = resolveTagAliases([first, second], [instanceTag("primary", "alias")]);

    expect(result).toHaveLength(1);
    expect(result[0].category).toBe("artist");
  });

  it("is a no-op for an empty instance result", () => {
    // Failure mode caught: resolution throwing or rewrapping tags when the
    // instance knows none of them.
    const a = new TagDetails(["a"]);
    const b = new TagDetails(["b"]);

    const result = resolveTagAliases([a, b], []);

    expect(result).toEqual([a, b]);
    expect(result[0]).toBe(a);
    expect(result[1]).toBe(b);
  });

  it("does not treat unrelated instance tags as aliases of each other", () => {
    // Failure mode caught: a name mapping to the wrong primary (e.g. matching
    // only part of the name instead of exact names[] membership).
    const scraped = new TagDetails(["primary-one"]);

    const result = resolveTagAliases([scraped], [instanceTag("primary-one"), instanceTag("primary-two", "alias-two")]);

    expect(result[0]).toBe(scraped);
  });
});
