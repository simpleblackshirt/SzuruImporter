import { BooruTypes, ContentType, ScrapedNote, ScrapedPost, ScrapedTag, UploadMode } from "neo-scraper";
import { MicroTag, Pool, Tag } from "~/api/models";
import type { PostUploadInfo } from "./messages";

export class TagDetails {
  public implications: TagDetails[] = [];

  constructor(
    public names: string[],
    public category?: string,
    public usages?: number,
    public profileUrl?: string,
  ) {}

  get name() {
    return this.names[0];
  }

  static fromTag(tag: Tag) {
    const x = new TagDetails(tag.names, tag.category, tag.usages);

    if (tag.implications) {
      x.implications = tag.implications.map((y) => TagDetails.fromMicroTag(y));
    }

    return x;
  }

  static fromMicroTag(tag: MicroTag) {
    return new TagDetails(tag.names, tag.category, tag.usages);
  }

  static fromScapedTag(tag: ScrapedTag): TagDetails {
    return new TagDetails([tag.name], tag.category, undefined, tag.profileUrl);
  }
}

export class PoolDetails {
  constructor(
    public names: string[],
    public category?: string,
    public postCount?: number,
  ) {}

  get name() {
    return this.names[0];
  }

  static fromPool(pool: Pool) {
    return new PoolDetails(pool.names, pool.category, pool.postCount);
  }
}

export class InstanceSpecificData {
  contentToken?: string;
  genericError?: string;
  reverseSearchResult?: SimpleImageSearchResult;
  uploadState?: PostUploadInfo;
}

type MappedInstanceSpecificData = {
  [key: string]: InstanceSpecificData;
};

export class ScrapedPostDetails {
  id = window.crypto.randomUUID();
  name = "";
  tags: TagDetails[] = [];
  pools: PoolDetails[] = [];
  notes: ScrapedNote[];
  contentUrl: string;
  extraContentUrl: string | undefined;
  contentSize: number | undefined;
  pageUrl: string;
  contentType: ContentType;
  contentSubType: string | undefined;
  rating: BooruTypes.SafetyRating;
  source;
  uploadMode: UploadMode;
  referrer?: string;
  resolution?: [number, number];
  instanceSpecificData: MappedInstanceSpecificData = {};

  constructor(post: ScrapedPost) {
    this.contentUrl = post.contentUrl;
    this.extraContentUrl = post.extraContentUrl;
    // this.contentSize = post.contentSize;
    this.pageUrl = post.pageUrl;
    this.contentType = post.contentType;
    this.rating = post.rating;
    this.source = post.sources.join("\n");
    this.referrer = post.referrer;
    this.tags = post.tags.map((x) => TagDetails.fromScapedTag(x));
    this.notes = post.notes;
    this.resolution = post.resolution;
    this.uploadMode = post.uploadMode;
  }
}

export interface SimpleImageSearchResult {
  exactPostId?: number;
  similarPosts: SimpleSimilarPost[];
}

export interface SimpleSimilarPost {
  distance: number;
  postId: number;
}

export class SimilarPostInfo {
  constructor(
    public readonly id: number,
    public readonly percentage: number,
  ) {}
}
