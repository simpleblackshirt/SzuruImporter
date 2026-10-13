import { describe, expect, it } from "vitest";
import xiaohongshu from "./xiaohongshu";

describe("xiaohongshu site adapter", () => {
  it("should declare the page hosts of the neo-scraper Xiaohongshu engine", () => {
    // Host data copied from neo-scraper src/engines/Xiaohongshu.ts @ efcea42.
    expect(xiaohongshu.hosts).toEqual(["xiaohongshu.com", "rednote.com"]);
  });

  it("should carry the note family for xiaohongshu/rednote source dedup", () => {
    // Relocated verbatim from the former utils POST_ID_FAMILIES entry.
    expect(xiaohongshu.sourceFamilies).toEqual([
      {
        hosts: ["xiaohongshu.com", "rednote.com"],
        idPath: /\/(explore|note|discovery\/item|user\/profile\/[^/]+)\/[^/]+$/,
      },
    ]);
  });
});
