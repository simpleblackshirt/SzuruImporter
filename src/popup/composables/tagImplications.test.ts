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
});
