import { describe, expect, it } from "vitest";
import { TagDetails } from "~/models";
import {
  clearStagedState,
  dedupeStaged,
  stagedSuggestions,
  stripStagedImplications,
  toStagedInfos,
  topoSortStaged,
  validateStaging,
  type StagedTagInfo,
} from "./staged-tags";

function stagedTag(name: string, category = "character", implications: string[] = []): StagedTagInfo {
  return { name, category, implications };
}

describe("toStagedInfos", () => {
  it("extracts only staged tags, falling back to the default category", () => {
    const known = new TagDetails(["known"], "artist", 5);
    const staged = new TagDetails(["staged"]);
    staged.category = "copyright";
    staged.staged = { implications: ["known"] };
    const categoryless = new TagDetails(["categoryless"]);
    categoryless.staged = { implications: [] };

    expect(toStagedInfos([known, staged, categoryless])).toEqual([
      { name: "staged", category: "copyright", implications: ["known"] },
      { name: "categoryless", category: "default", implications: [] },
    ]);
  });
});

describe("dedupeStaged", () => {
  it("keeps the first occurrence per name", () => {
    const infos = [stagedTag("a", "artist"), stagedTag("b"), stagedTag("a", "character")];
    expect(dedupeStaged(infos)).toEqual([stagedTag("a", "artist"), stagedTag("b")]);
  });
});

describe("validateStaging", () => {
  it("accepts known and staged implication targets", () => {
    const staged = [stagedTag("other"), stagedTag("solo")];
    expect(validateStaging("new_tag", ["known_tag", "other"], staged, ["known_tag", "hair"])).toBeUndefined();
  });

  it("refuses self-implication", () => {
    expect(validateStaging("new_tag", ["new_tag"], [], [])).toContain("cannot imply itself");
  });

  it("refuses targets that are neither known nor staged", () => {
    const error = validateStaging("new_tag", ["ghost_tag"], [stagedTag("other")], ["known_tag"]);
    expect(error).toContain("ghost_tag");
  });

  it("refuses a direct two-tag cycle", () => {
    const staged = [stagedTag("a", "character", ["b"]), stagedTag("b", "character", ["a"])];
    expect(validateStaging("new_tag", ["a"], staged, [])).toContain("cycle");
  });

  it("refuses making an existing staged cycle longer", () => {
    // Adding a tag that implies into a staged cycle keeps the cycle alive.
    const staged = [stagedTag("a", "character", ["b"]), stagedTag("b", "character", ["a"])];
    expect(validateStaging("new_tag", ["a", "b"], staged, [])).toContain("cycle");
  });

  it("accepts implication chains among staged tags", () => {
    const staged = [stagedTag("a", "character", ["b"]), stagedTag("b", "character", ["c"])];
    expect(validateStaging("new_tag", ["a"], staged, [])).toBeUndefined();
  });

  it("does not walk through known targets when checking cycles", () => {
    // known_tag exists on the server and cannot imply a staged tag, so
    // staged -> known -> staged must not be treated as a cycle.
    const staged = [stagedTag("a"), stagedTag("b", "character", ["known_tag"])];
    expect(validateStaging("new_tag", ["a", "b"], staged, ["known_tag"])).toBeUndefined();
  });

  it("ignores duplicate implication entries", () => {
    expect(validateStaging("new_tag", ["known_tag", "known_tag"], [], ["known_tag"])).toBeUndefined();
  });
});

describe("topoSortStaged", () => {
  it("emits implied tags before the tags implying them", () => {
    const staged = [
      stagedTag("long_hair", "meta", ["hair"]),
      stagedTag("hair"),
      stagedTag("twintails", "character", ["long_hair", "hair"]),
    ];

    const order = topoSortStaged(staged).map((x) => x.name);
    expect(order.indexOf("hair")).toBeLessThan(order.indexOf("long_hair"));
    expect(order.indexOf("long_hair")).toBeLessThan(order.indexOf("twintails"));
    expect(order.indexOf("hair")).toBeLessThan(order.indexOf("twintails"));
    expect(order).toHaveLength(3);
  });

  it("keeps unrelated tags in input order", () => {
    const staged = [stagedTag("b"), stagedTag("a")];
    expect(topoSortStaged(staged).map((x) => x.name)).toEqual(["b", "a"]);
  });

  it("handles diamond dependencies", () => {
    const staged = [
      stagedTag("root"),
      stagedTag("left", "meta", ["root"]),
      stagedTag("right", "meta", ["root"]),
      stagedTag("tip", "meta", ["left", "right"]),
    ];

    const order = topoSortStaged(staged).map((x) => x.name);
    expect(order.indexOf("root")).toBeLessThan(order.indexOf("left"));
    expect(order.indexOf("root")).toBeLessThan(order.indexOf("right"));
    expect(order.indexOf("left")).toBeLessThan(order.indexOf("tip"));
    expect(order.indexOf("right")).toBeLessThan(order.indexOf("tip"));
  });

  it("tolerates a cycle by emitting the remaining tags in input order", () => {
    // Staging validation refuses cycles; the sort must not hang anyway.
    const staged = [stagedTag("a", "character", ["b"]), stagedTag("b", "character", ["a"])];
    const order = topoSortStaged(staged).map((x) => x.name);
    expect(order).toHaveLength(2);
  });
});

describe("stripStagedImplications", () => {
  it("removes the name from every staged tag's implication list, in place", () => {
    const a = new TagDetails(["a"]);
    a.staged = { implications: ["removed", "other"] };
    const b = new TagDetails(["b"]);
    b.staged = { implications: ["removed"] };
    const known = new TagDetails(["known"], "artist", 2);
    const tags = [a, b, known];

    stripStagedImplications(tags, "removed");

    expect(a.staged!.implications).toEqual(["other"]);
    expect(b.staged!.implications).toEqual([]);
    expect(known.staged).toBeUndefined();
  });
});

describe("clearStagedState", () => {
  it("drops the staged marker from every tag", () => {
    const a = new TagDetails(["a"]);
    a.staged = { implications: ["b"] };
    const b = new TagDetails(["b"], "artist", 3);
    const tags = [a, b];

    clearStagedState(tags);

    expect(a.staged).toBeUndefined();
    expect(b.staged).toBeUndefined();
    expect(a.category).toBeUndefined();
  });
});

describe("stagedSuggestions", () => {
  const staged = [stagedTag("long_hair", "meta"), stagedTag("hair_ornament"), stagedTag("twintails")];

  it("matches short inputs as a prefix", () => {
    expect(stagedSuggestions(staged, "twi").map((x) => x.name)).toEqual(["twintails"]);
  });

  it("matches longer inputs as a substring", () => {
    expect(stagedSuggestions(staged, "hair").map((x) => x.name)).toEqual(["long_hair", "hair_ornament"]);
  });

  it("passes a typed wildcard through verbatim", () => {
    expect(stagedSuggestions(staged, "*ornament").map((x) => x.name)).toEqual(["hair_ornament"]);
  });

  it("normalizes whitespace like normalizeName", () => {
    expect(stagedSuggestions(staged, "twintails ").map((x) => x.name)).toEqual(["twintails"]);
  });

  it("returns nothing for wildcard-only input", () => {
    expect(stagedSuggestions(staged, "*")).toEqual([]);
  });

  it("builds TagDetails with the staged marker and category", () => {
    const [tag] = stagedSuggestions(staged, "twi");
    expect(tag.name).toBe("twintails");
    expect(tag.category).toBe("character");
    expect(tag.staged).toEqual({ implications: [] });
  });
});
