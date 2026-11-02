import { describe, expect, it } from "vitest";
import { TagDetails } from "~/models";
import { pushTagWithImplications } from "./tagImplications";

describe("pushTagWithImplications", () => {
  it("appends the tag followed by its implications when expansion is on", () => {
    const tag = new TagDetails(["tag"]);
    tag.implications = [new TagDetails(["implication"])];
    const target: TagDetails[] = [];

    pushTagWithImplications(target, tag, true);

    expect(target.map((t) => t.name)).toEqual(["tag", "implication"]);
  });

  // Failure mode caught: the two pages drifting apart, one expanding
  // implications while the other skips them.
  it("appends only the tag when implication expansion is off", () => {
    const tag = new TagDetails(["tag"]);
    tag.implications = [new TagDetails(["implication"])];
    const target: TagDetails[] = [];

    pushTagWithImplications(target, tag, false);

    expect(target.map((t) => t.name)).toEqual(["tag"]);
  });

  // Failure mode caught: an implied tag that is already in the list was
  // pushed again, showing it twice in the UI (uploads stayed correct because
  // the server dedupes the names).
  it("skips implications that are already in the target list", () => {
    const tag = new TagDetails(["tag"]);
    tag.implications = [new TagDetails(["implication"]), new TagDetails(["other"])];
    const target: TagDetails[] = [new TagDetails(["implication"])];

    pushTagWithImplications(target, tag, true);

    expect(target.map((t) => t.name)).toEqual(["implication", "tag", "other"]);
  });

  it("skips the tag itself when the default check finds it in the target", () => {
    const tag = new TagDetails(["tag"]);
    const target: TagDetails[] = [new TagDetails(["tag"])];

    pushTagWithImplications(target, tag, false);

    expect(target).toHaveLength(1);
  });

  it("uses the custom predicate for the tag and its implications", () => {
    // Merge-style predicate: the target list plus the post's existing tags
    // count as present.
    const tag = new TagDetails(["tag"]);
    tag.implications = [new TagDetails(["alreadyOnPost"]), new TagDetails(["queued"])];
    const target: TagDetails[] = [new TagDetails(["queued"])];
    const exists = (candidate: TagDetails) =>
      target.some((x) => x.name == candidate.name) || ["alreadyOnPost"].includes(candidate.name);

    pushTagWithImplications(target, tag, true, exists);

    expect(target.map((t) => t.name)).toEqual(["queued", "tag"]);
  });
});
